import * as chrono from "chrono-node";

const timePatterns = [
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\s?[-–]\s?\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i,
  /\b(?:doors open|vendor setup)\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s?(?:am|pm)?\b/i
];

export function extractDate(text: string, sourceDate = new Date()) {
  const results = chrono.casual.parse(text, sourceDate, { forwardDate: true });
  const first = results[0];
  if (!first) return {};
  const startDate = first.start.date().toISOString();
  const endDate = first.end?.date().toISOString();
  return { startDate, endDate };
}

export function extractTimeText(text: string) {
  return timePatterns.map((pattern) => text.match(pattern)?.[0]).find(Boolean);
}
