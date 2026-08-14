export function finishRunFlavour(flavourText: string): string {
  if (flavourText.startsWith("Croft is ")) return `Croft was ${flavourText.slice(9)}`;
  return flavourText;
}
