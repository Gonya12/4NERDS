const urlRegex = /https?:\/\/[^\s)]+/gi;

const registrationHints = [
  "register",
  "vendor",
  "vendors",
  "table",
  "booth",
  "form",
  "apply",
  "eventbrite",
  "jotform",
  "google"
];

export function extractLinks(text: string) {
  return Array.from(new Set(text.match(urlRegex) || [])).map((link) => link.replace(/[.,]+$/, ""));
}

export function pickRegistrationLink(text: string) {
  const links = extractLinks(text);
  return links.find((link) => registrationHints.some((hint) => link.toLowerCase().includes(hint))) || links[0];
}
