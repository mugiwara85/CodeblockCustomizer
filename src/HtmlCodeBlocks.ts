// code blocks written as HTML (<pre><code class="language-xxx" data-cbc="...">...</code></pre>) are converted to an equivalent fence line ("```xxx ...")

export interface HtmlCodeBlock {
  preStartLine: number;
  codeOpenLine: number;
  codeCloseLine: number;
  preEndLine: number;
  firstLine: string;
}

const PRE_START_REGEX = /^ {0,3}<pre(?=[\s>]|$)/i;
const HTML_FIRST_LINE_REGEX = /^\s*<(?:pre|code)(?=[\s>]|$)/i;
const CODE_OPEN_TAG_REGEX = /<code(?=[\s>])([^>]*)>/i;
const ATTRIBUTE_REGEX = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const FENCE_REGEX = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function isHtmlCodeBlockStart(line: string): boolean {
  return PRE_START_REGEX.test(line);
}// isHtmlCodeBlockStart

export function htmlLineToFenceLine(line: string): string | null {
  if (!HTML_FIRST_LINE_REGEX.test(line)) {
    return null;
  }

  const match = line.match(CODE_OPEN_TAG_REGEX);
  if (!match) {
    return null;
  }

  const attributes = parseAttributes(match[1]);
  const parameters = getCodeAttributeParameters(attributes['class'] ?? '', attributes['data-cbc'] ?? '');

  return '```' + parameters;
}// htmlLineToFenceLine

// the language (from the language-xxx class) and the parameters (from the data-cbc attribute) of a <code> element
export function getCodeAttributeParameters(className: string, dataCbc: string): string {
  const languageClass = className.split(/\s+/).find(cls => cls.toLowerCase().startsWith('language-'));
  const language = languageClass ? languageClass.substring('language-'.length) : '';
  const parameters = dataCbc.trim();

  return language + (parameters.length > 0 ? ' ' + parameters : '');
}// getCodeAttributeParameters

export function getInlineCodeAttributeParameters(className: string, dataCbc: string): string {
  const languageClass = className.split(/\s+/).find(cls => cls.toLowerCase().startsWith('language-'));
  const language = languageClass ? languageClass.substring('language-'.length) : '';

  return [language, dataCbc.trim()].filter(s => s.length > 0).join(' ');
}// getInlineCodeAttributeParameters

export function combineInlineCodeParameters(prefixParameters: string | null, attributeParameters: string): string {
  return [prefixParameters?.trim() ?? '', attributeParameters.trim()].filter(s => s.length > 0).join(' ');
}// combineInlineCodeParameters

export interface HtmlInlineCode {
  from: number;         // start of <code
  to: number;           // end of </code>
  contentFrom: number;
  contentTo: number;
  parameters: string;   // from the attributes
}

export function findHtmlInlineCodes(line: string): HtmlInlineCode[] {
  const result: HtmlInlineCode[] = [];
  const preIndex = line.search(/<pre(?=[\s>])/i);

  for (const match of line.matchAll(/<code(?=[\s>])([^>]*)>([\s\S]*?)<\/code>/gi)) {
    const from = match.index ?? 0;
    if (preIndex !== -1 && preIndex < from) {
      break;
    }

    const attributes = parseAttributes(match[1]);
    const contentFrom = from + match[0].length - match[2].length - '</code>'.length;
    result.push({
      from,
      to: from + match[0].length,
      contentFrom,
      contentTo: contentFrom + match[2].length,
      parameters: getInlineCodeAttributeParameters(attributes['class'] ?? '', attributes['data-cbc'] ?? '')
    });
  }

  return result;
}// findHtmlInlineCodes

function parseAttributes(attributeText: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of attributeText.matchAll(ATTRIBUTE_REGEX)) {
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(value);
  }
  return attributes;
}// parseAttributes

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === '#') {
      const codePoint = name[1] === 'x' || name[1] === 'X' ? parseInt(name.substring(2), 16) : parseInt(name.substring(1), 10);
      return codePoint > 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : entity;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}// decodeHtmlEntities

export function findHtmlCodeBlock(getLine: (index: number) => string, lineCount: number, startLine: number): HtmlCodeBlock | null {
  let preEndLine = -1;
  for (let i = startLine; i < lineCount; i++) {
    if (/<\/pre>/i.test(getLine(i))) {
      preEndLine = i;
      break;
    }
  }

  if (preEndLine === -1) {
    return null;
  }

  let codeOpenLine = -1;
  let codeCloseLine = -1;
  for (let i = startLine; i <= preEndLine; i++) {
    const line = getLine(i);
    if (codeOpenLine === -1) {
      const openTag = line.match(CODE_OPEN_TAG_REGEX);
      if (openTag) {
        codeOpenLine = i;
        // </code> on the same line like the opening tag
        if (/<\/code>/i.test(line.substring((openTag.index ?? 0) + openTag[0].length))) {
          codeCloseLine = i;
          break;
        }
      }
    } else if (/<\/code>/i.test(line)) {
      codeCloseLine = i;
      break;
    }
  }

  if (codeOpenLine === -1 || codeCloseLine === -1 || codeOpenLine === codeCloseLine) {
    return null;
  }

  const firstLine = htmlLineToFenceLine(getLine(codeOpenLine)) ?? '```';

  return { preStartLine: startLine, codeOpenLine, codeCloseLine, preEndLine, firstLine };
}// findHtmlCodeBlock

export function findHtmlCodeBlocks(getLine: (index: number) => string, lineCount: number): HtmlCodeBlock[] {
  const blocks: HtmlCodeBlock[] = [];
  let fence: { char: string, count: number } | null = null;
  let i = 0;

  if (lineCount > 0 && getLine(0).trimEnd() === '---') {
    for (let j = 1; j < lineCount; j++) {
      const line = getLine(j).trimEnd();
      if (line === '---' || line === '...') {
        i = j + 1;
        break;
      }
    }
  }

  for (; i < lineCount; i++) {
    const line = getLine(i);

    const fenceMatch = line.match(FENCE_REGEX);
    if (fenceMatch) {
      const char = fenceMatch[1][0];
      const count = fenceMatch[1].length;
      if (!fence) {
        fence = { char, count };
      } else if (char === fence.char && count >= fence.count && fenceMatch[2].trim() === '') {
        fence = null;
      }
      continue;
    }

    if (fence || !isHtmlCodeBlockStart(line)) {
      continue;
    }

    const previousLine = i > 0 ? getLine(i - 1).trim() : '';
    const previousBlockEndsBefore = blocks.length > 0 && blocks[blocks.length - 1].preEndLine === i - 1;
    if (previousLine.length > 0 && previousLine.startsWith('<') && !previousBlockEndsBefore) {
      continue;
    }

    const block = findHtmlCodeBlock(getLine, lineCount, i);
    if (block) {
      blocks.push(block);
      i = block.preEndLine;
    }
  }

  return blocks;
}// findHtmlCodeBlocks

export function getHtmlCodeBlockCode(lines: string[]): string {
  const text = lines.join('\n');
  const openTag = text.match(CODE_OPEN_TAG_REGEX);
  const start = openTag ? (openTag.index ?? 0) + openTag[0].length : 0;
  const closeIndex = text.toLowerCase().lastIndexOf('</code>');
  const end = closeIndex >= start ? closeIndex : text.length;

  return trimCodeNewlines(decodeHtmlEntities(text.substring(start, end).replace(/<[^>]*>/g, '')));
}// getHtmlCodeBlockCode

export function trimCodeNewlines(code: string): string {
  return code.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}// trimCodeNewlines

// number of <pre><code> elements in the text of an HTML section (used to match rendered <pre> elements during PDF export)
export function countHtmlCodeElements(text: string): number {
  const preElements = text.match(/<pre(?=[\s>])[\s\S]*?<\/pre>/gi) ?? [];
  return preElements.filter(pre => /<code(?=[\s>])/i.test(pre)).length;
}// countHtmlCodeElements
