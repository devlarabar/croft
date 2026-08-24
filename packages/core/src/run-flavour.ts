export function finishRunFlavour(flavourText: string): string {
  if (flavourText.startsWith("I'm ")) return `I was ${flavourText.slice(4)}`;
  return flavourText;
}
