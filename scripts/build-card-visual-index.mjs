import { mkdir, writeFile } from "node:fs/promises";
import { env, pipeline, RawImage } from "@huggingface/transformers";

env.allowLocalModels = false;
const outputDir = new URL("../public/card-index/", import.meta.url);
const model = "Xenova/clip-vit-base-patch32";
const shardSize = 500;
const extractor = await pipeline("image-feature-extraction", model, { dtype: "q8" });
await mkdir(outputDir, { recursive: true });

const cards = [];
let page = 1;
while (true) {
  const url = `https://api.pokemontcg.io/v2/cards?page=${page}&pageSize=250&select=id,name,number,set,rarity,images,tcgplayer`;
  const headers = process.env.POKEMON_TCG_API_KEY ? { "X-Api-Key": process.env.POKEMON_TCG_API_KEY } : {};
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Pokémon TCG API returned ${response.status} on page ${page}`);
  const payload = await response.json();
  cards.push(...payload.data);
  if (cards.length >= payload.totalCount) break;
  page++;
}

const shardNames = [];
for (let offset = 0; offset < cards.length; offset += shardSize) {
  const rows = [];
  for (const card of cards.slice(offset, offset + shardSize)) {
    const image = await RawImage.read(card.images.small);
    const output = await extractor(image, { pooling: "mean", normalize: true });
    const priceGroups = Object.values(card.tcgplayer?.prices || {});
    const marketPrice = priceGroups.map((group) => group.market || group.mid).find((value) => typeof value === "number");
    const quantized = Uint8Array.from(output.data, (value) => Math.max(0, Math.min(255, Math.round(value * 127) + 128)));
    rows.push({
      id: card.id, name: card.name, number: card.number, setName: card.set.name, rarity: card.rarity,
      imageUrl: card.images.small, marketPrice, embedding: Buffer.from(quantized).toString("base64")
    });
    console.log(`Embedded ${offset + rows.length} of ${cards.length}: ${card.name}`);
  }
  const name = `cards-${String(offset / shardSize).padStart(3, "0")}.json`;
  await writeFile(new URL(name, outputDir), JSON.stringify(rows));
  shardNames.push(name);
}
await writeFile(new URL("manifest.json", outputDir), JSON.stringify({ version: new Date().toISOString(), model, dimensions: 512, shards: shardNames }, null, 2));
