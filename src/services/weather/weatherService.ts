import { geocodeAddress } from "../distance/geocoder";

export type WeatherSummary = {
  temperature?: number;
  rainChance?: number;
  icon: string;
  label: string;
};

function iconFor(code?: number) {
  if (code === undefined) return "🌤";
  if (code >= 61 && code <= 82) return "🌧";
  if (code >= 95) return "⛈";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 1 && code <= 3) return "⛅";
  return "☀️";
}

export async function getEventWeather(address: string, date: string): Promise<WeatherSummary | undefined> {
  if (!address) return undefined;
  const geo = await geocodeAddress(address);
  if (!geo) return undefined;
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(geo.latitude));
  url.searchParams.set("longitude", String(geo.longitude));
  url.searchParams.set("daily", "temperature_2m_max,precipitation_probability_max,weather_code");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("start_date", date.slice(0, 10));
  url.searchParams.set("end_date", date.slice(0, 10));
  const response = await fetch(url);
  if (!response.ok) return undefined;
  const data = await response.json();
  const temperature = data.daily?.temperature_2m_max?.[0];
  const rainChance = data.daily?.precipitation_probability_max?.[0];
  const code = data.daily?.weather_code?.[0];
  return {
    temperature: temperature !== undefined ? Math.round(Number(temperature)) : undefined,
    rainChance: rainChance !== undefined ? Math.round(Number(rainChance)) : undefined,
    icon: iconFor(code),
    label: temperature !== undefined ? `${Math.round(Number(temperature))}°F` : "Weather unavailable"
  };
}
