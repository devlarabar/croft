// Line-anchored review comments are rejected (422) unless the line is part of
// the PR's diff, and one bad anchor fails the whole review — so anchors are
// checked against the diff before submitting.
// Maps each changed file to the new-file line numbers inside its hunks
// (added and context lines; deleted lines exist only on the old side).
export function commentableLines(diff: string): Map<string, Set<number>> {
  const byPath = new Map<string, Set<number>>();
  let lines: Set<number> | undefined;
  let newLine = 0;
  for (const line of diff.split("\n")) {
    const fileHeader = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileHeader) {
      lines = new Set();
      byPath.set(fileHeader[1]!, lines);
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!lines) continue;
    if (line.startsWith("+") || line.startsWith(" ")) lines.add(newLine++);
  }
  return byPath;
}
