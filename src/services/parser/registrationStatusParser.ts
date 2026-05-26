import type { RegistrationStatus } from "../../types/models";

const statusPatterns: Array<[RegistrationStatus, RegExp]> = [
  ["sold_out", /\b(sold out|no tables left|fully booked|\bfull\b)/i],
  ["waitlist", /\b(waitlist|wait list|join the waitlist)/i],
  ["closed", /\b(registration closed|applications closed|deadline passed|vendor registration closed)/i],
  ["open", /\b(registration open|vendor registration open|now accepting vendors|tables available|vendors wanted|apply now)/i]
];

export function parseRegistrationStatus(text: string): RegistrationStatus {
  return statusPatterns.find(([, pattern]) => pattern.test(text))?.[0] || "unknown";
}
