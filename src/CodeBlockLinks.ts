export function getDisplayNameAndReference(input: string): { displayName: string, reference: string } {
  const displayNameMarker = "|";
  const referenceMarker = "#";

  const displayNameIndex = input.lastIndexOf(displayNameMarker);
  const referenceIndex = input.indexOf(referenceMarker);

  const result: { displayName: string, reference: string } = {
    displayName: '',
    reference: ''
  };

  if (displayNameIndex !== -1) {
    result.displayName = input.substring(displayNameIndex);
  }

  if (referenceIndex !== -1) {
    result.reference = input.substring(referenceIndex, displayNameIndex !== -1 ? displayNameIndex : undefined);
  }

  return result;
}// getDisplayNameAndReference

// the new text of the link [[linkText]] after "oldPath" was renamed to "newPath", or null if the link stays as it is
// "linkResolves" - the link still points to an existing file ==> it isn't a link to the renamed one
export function getRenamedLinkText(linkText: string, oldPath: string, newPath: string, newExtension: string | null, linkResolves: boolean): string | null {
  if (linkResolves) {
    return null;
  }

  const { displayName, reference } = getDisplayNameAndReference(linkText);
  const target = linkText.split('|')[0].split('#')[0];
  const hasFolder = target.includes('/');
  const oldPathWithoutFolder = oldPath.split('/').slice(-1)[0];

  let isLinkToOldPath: boolean;
  let newTarget: string;
  if (newExtension !== null && target.includes(newExtension)) {
    // SomeFolder/Untitled 22.md or Untitled 22.md
    isLinkToOldPath = target.toLowerCase() === (hasFolder ? oldPath : oldPathWithoutFolder).toLowerCase();
    newTarget = newPath;
  } else {
    // SomeFolder/Untitled 22 or Untitled 22
    const oldTarget = (hasFolder ? oldPath : oldPathWithoutFolder).replace(/\.[^.]*$/, '');
    isLinkToOldPath = oldTarget.length > 0 && target.toLowerCase() === oldTarget.toLowerCase();
    newTarget = newPath.replace(/\.[^.]*$/, '');
  }

  return isLinkToOldPath ? newTarget + reference + displayName : null;
}// getRenamedLinkText

export function replaceLinesIfUnchanged(content: string, startLine: number, endLine: number, originalText: string, newText: string): string | null {
  const lines = content.split('\n');
  if (lines.slice(startLine, endLine + 1).join('\n') !== originalText) {
    return null;
  }

  lines.splice(startLine, endLine - startLine + 1, ...newText.split('\n'));
  
  return lines.join('\n');
}// replaceLinesIfUnchanged
