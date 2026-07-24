# Visual card index

The hybrid scanner reads `manifest.json` and its versioned shard files from this
directory. Generate them outside the browser:

```sh
npm run build:card-index
```

The builder fetches Pokémon TCG API v2 metadata and official small card images,
creates CLIP-compatible embeddings, quantizes each vector to signed 8-bit data,
and writes 500-card JSON shards. `POKEMON_TCG_API_KEY` is optional and is read
only by the Node indexing process.

Do not hand-create an empty `manifest.json`: absence of a real index deliberately
activates the OCR/manual low-memory fallback.
