import * as cheerio from "cheerio";

type ApiRequest = {
  method?: string;
  query: {
    url?: string | string[];
  };
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: ProductPreviewResponse) => void;
};

type ProductPreviewResponse = {
  success: boolean;
  title?: string;
  image_url?: string;
  description?: string;
  estimated_price?: number;
  source_url?: string;
  error?: string;
};

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Only GET requests are supported." });
  }

  const rawUrl = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  const sourceUrl = validateUrl(rawUrl);
  if (!sourceUrl) {
    return res.status(400).json({ success: false, error: "A valid http or https URL is required." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return res.status(200).json({
        success: false,
        source_url: sourceUrl,
        error: `Product page returned ${response.status}.`
      });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title =
      firstText(
        meta($, "property", "og:title"),
        meta($, "name", "twitter:title"),
        $("title").first().text(),
        $("#productTitle").first().text()
      ) || undefined;

    const image = firstText(
      meta($, "property", "og:image"),
      meta($, "name", "twitter:image"),
      $("#landingImage").attr("data-old-hires"),
      $("#landingImage").attr("src")
    );

    const description =
      firstText(
        meta($, "property", "og:description"),
        meta($, "name", "twitter:description"),
        $("[name='description']").attr("content"),
        $("#productDescription").text()
      ) || undefined;

    const priceText = firstText(
      $(".a-price .a-offscreen").first().text(),
      $("#priceblock_ourprice").first().text(),
      $("#priceblock_dealprice").first().text(),
      $("#corePrice_feature_div .a-offscreen").first().text(),
      $("[data-a-color='price'] .a-offscreen").first().text()
    );

    const preview: ProductPreviewResponse = {
      success: Boolean(title || image || description || priceText),
      title,
      image_url: image ? resolveUrl(image, sourceUrl) : undefined,
      description,
      estimated_price: parsePrice(priceText),
      source_url: sourceUrl
    };

    if (!preview.success) {
      preview.error = "Could not find product preview metadata.";
    }

    return res.status(200).json(preview);
  } catch (error) {
    return res.status(200).json({
      success: false,
      source_url: sourceUrl,
      error: error instanceof Error && error.name === "AbortError" ? "Product preview timed out." : "Could not preview this link."
    });
  } finally {
    clearTimeout(timeout);
  }
}

function validateUrl(rawUrl?: string) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function meta($: cheerio.CheerioAPI, attribute: "property" | "name", value: string) {
  return $(`meta[${attribute}='${value}']`).first().attr("content");
}

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function firstText(...values: Array<string | undefined | null>) {
  return values.map(cleanText).find(Boolean) || "";
}

function parsePrice(value: string) {
  const match = cleanText(value).match(/(?:US\s*)?\$?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i);
  if (!match) return undefined;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveUrl(value: string, sourceUrl: string) {
  try {
    return new URL(value, sourceUrl).toString();
  } catch {
    return value;
  }
}
