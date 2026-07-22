const rawBuyPercentageKey = "4nerds_default_raw_buy_percentage_v1";

export function loadDefaultRawBuyPercentage() {
  const value = Number(localStorage.getItem(rawBuyPercentageKey) || 75);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : 75;
}

export function saveDefaultRawBuyPercentage(value: number) {
  const safeValue = Math.min(100, Math.max(1, Number(value) || 75));
  localStorage.setItem(rawBuyPercentageKey, String(safeValue));
  return safeValue;
}
