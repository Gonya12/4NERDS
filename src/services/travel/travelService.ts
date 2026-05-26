export function estimateDriveMinutes(distanceMiles?: number) {
  if (!distanceMiles) return undefined;
  return Math.max(10, Math.round((distanceMiles / 38) * 60));
}

export function departureTime(arrivalDate: string, setupTime?: string, driveMinutes?: number) {
  if (!setupTime || !driveMinutes) return "";
  const date = new Date(`${arrivalDate.slice(0, 10)}T${setupTime}`);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - driveMinutes - 15);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
