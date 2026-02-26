import { CBCParameters } from "../Parsing";
import { CodeBlockPositions } from "./CodeBlockPositions";

function areParametersDeepEqual(params1: CBCParameters, params2: CBCParameters): boolean {
  if (params1.isSpecificNumber !== params2.isSpecificNumber)
    return false;
  if (params1.lineNumberOffset !== params2.lineNumberOffset)
    return false;
  if (params1.showNumbers !== params2.showNumbers)
    return false;
  if (params1.headerDisplayText !== params2.headerDisplayText)
    return false;
  if (params1.fold !== params2.fold)
    return false;
  if (params1.unfold !== params2.unfold)
    return false;
  if (params1.language !== params2.language)
    return false;
  if (params1.displayLanguage !== params2.displayLanguage)
    return false;
  if (params1.hasLangBorderColor !== params2.hasLangBorderColor)
    return false;
  if (params1.exclude !== params2.exclude)
    return false;
  if (params1.fenceCount !== params2.fenceCount)
    return false;
  if (params1.fenceChar !== params2.fenceChar)
    return false;
  if (params1.indentLevel !== params2.indentLevel)
    return false;
  if (params1.indentCharacter !== params2.indentCharacter)
    return false;
  if (params1.lineSeparator !== params2.lineSeparator)
    return false;
  if (params1.textSeparator !== params2.textSeparator)
    return false;
  if (params1.group !== params2.group)
    return false;
  if (params1.tab !== params2.tab)
    return false;

  return true;
}// areParametersDeepEqual

export function areCodeBlockPositionsEqual(pos1: CodeBlockPositions, pos2: CodeBlockPositions): boolean {
  if (pos1.codeBlockStartPos !== pos2.codeBlockStartPos)
    return false;
  if (pos1.codeBlockEndPos !== pos2.codeBlockEndPos)
    return false;
  if (!areParametersDeepEqual(pos1.parameters, pos2.parameters))
    return false;

  return true;
}// areCodeBlockPositionsEqual

export function areGroupMembersEqual(members1: CodeBlockPositions[], members2: CodeBlockPositions[]): boolean {
  if (members1.length !== members2.length)
    return false;
  for (let i = 0; i < members1.length; i++) {
    if (!areCodeBlockPositionsEqual(members1[i], members2[i]))
      return false;
  }
  return true;
}// areGroupMembersEqual

export function compareCodeBlockPositions(pos1: CodeBlockPositions[], pos2: CodeBlockPositions[]): boolean {
  if (pos1.length !== pos2.length) {
    return false;
  }

  for (let i = 0; i < pos1.length; i++) {
    const p1 = pos1[i];
    const p2 = pos2[i];

    if (p1.codeBlockFirstLineText !== p2.codeBlockFirstLineText) {
      return false;
    }

    const len1 = p1.codeBlockEndPos - p1.codeBlockStartPos;
    const len2 = p2.codeBlockEndPos - p2.codeBlockStartPos;
    if (len1 !== len2) {
      return false;
    }
  }

  return true;
}// compareCodeBlockPositions

export function areObjectsEqual(obj1: Record<string, string> | null | undefined, obj2: Record<string, string> | null | undefined): boolean {
  if (obj1 === null && obj2 === null) {
    return true;
  }

  if ((obj1 === null || obj1 === undefined) || (obj2 === null || obj2 === undefined)) {
    return false;
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    if (obj1[key] !== obj2[key]) {
      return false;
    }
  }

  return true;
}// areObjectsEqual
