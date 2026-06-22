import { addDebugLog } from "../services/debug/debugLog";

export async function copyTextToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    addDebugLog("error", "Clipboard API failed, using fallback", error);
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    const copied = document.execCommand("copy");
    return copied;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function safeDateFromLocalInput(value: string) {
  if (!value) return new Date();
  const [datePart, timePart = "12:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0, 0);
}

export function safeDateFromDateOnly(value: string, fallbackTime = "12:00") {
  return safeDateFromLocalInput(`${value.slice(0, 10)}T${fallbackTime}`);
}
