// XML declaration, DOCTYPE and comments in front of the <svg> root tag (e.g. files exported from Inkscape or Illustrator)
const PROLOG_REGEX = /^(?:<\?xml[^>]*>\s*|<!DOCTYPE[^>]*>\s*|<!--[\s\S]*?-->\s*)*/i;
const SIZE_ATTRIBUTE_REGEX = /\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi;

// Every icon is drawn in the same 32x32 box. Built-in icons and old style custom icons only contain the content of the SVG, drawn on a 32x32 grid.
// Complete SVG files are nested inside the box, so their own viewBox scales them (e.g. 24x24 icons from Simple Icons), they are centered, and content outside of their viewBox is clipped.
export function buildSvg(content: string): string {
  const svg = content.trim().replace(PROLOG_REGEX, "");
  if (!/^<svg[\s>]/i.test(svg)) {
    return wrapSvg(content);
  }

  // a fixed width/height (e.g. width="48mm") would be used instead of filling the box
  return wrapSvg(svg.replace(/^<svg[^>]*>/i, rootTag => rootTag.replace(SIZE_ATTRIBUTE_REGEX, "")));
}// buildSvg

function wrapSvg(content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32">${content}</svg>`;
}// wrapSvg

// btoa() throws exception on non Latin-1 characters (e.g. © in a <title>), so switch to encodeURIComponent
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}// svgToDataUri
