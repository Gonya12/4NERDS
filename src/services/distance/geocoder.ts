import { db } from "../storage/localDb";

let lastGeocodeAt = 0;

export async function geocodeAddress(address: string) {
  const key = address.trim().toLowerCase();
  if (!key) return undefined;
  const cached = await db.geocodes.get(key);
  if (cached) return cached;

  const waitMs = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastGeocodeAt = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
    headers: { "Accept": "application/json" }
  });
  if (!response.ok) throw new Error(`Geocoding returned ${response.status}`);
  const [result] = await response.json();
  if (!result) return undefined;
  const entry = {
    address: key,
    latitude: Number(result.lat),
    longitude: Number(result.lon),
    checkedAt: new Date().toISOString()
  };
  await db.geocodes.put(entry);
  return entry;
}
