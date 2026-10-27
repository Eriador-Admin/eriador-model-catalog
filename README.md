# eriador-model-catalog

A curated, public, PR-governed catalog of open-source LLMs. Each row describes one model — its family, size, per-tier hardware requirements, use cases, and (optionally) a Hugging Face GGUF pointer for direct download.

Consumers fetch [`local-models/v1/catalog.json`](local-models/v1/catalog.json) at build time or at runtime and render it as a model picker or recommendation UI. Everything in this repo is public and MIT-licensed.

## Why this exists

Open-source LLM releases move fast. New model families ship every month, and existing ones get deprecated, renamed, or moved between quant maintainers. Baking the model list into an app means shipping a release for every catalog change; hosting it here means the catalog is a PR away from any consumer.

## What lives here

```
local-models/v1/
├── catalog.json     ← model weights / GGUF pointers (consumers fetch for picker UI)
└── schema.json

local-runtimes/v1/
├── runtime-catalog.json  ← pinned llama-server (etc.) binaries per platform
└── schema.json

scripts/
├── validate.mjs           ← schema + duplicate-id check (models)
├── validate-runtimes.mjs  ← schema check (runtime binaries)
└── verify-hf-urls.mjs     ← HEAD every gguf URL against Hugging Face (warn-only)

.github/workflows/
└── validate.yml           ← runs the two scripts on every push + PR
```

## Consuming the catalog

**Model weights** (GGUF pointers, hardware requirements):

```
https://raw.githubusercontent.com/Eriador-Admin/eriador-model-catalog/main/local-models/v1/catalog.json
```

**Runtime binaries** (llama-server per OS/arch — Anfalas Desktop):

```
https://raw.githubusercontent.com/Eriador-Admin/eriador-model-catalog/main/local-runtimes/v1/runtime-catalog.json
```

No credentials or tokens are ever required — the repo is fully public and the URL is stable. A production-grade consumer should:

- Cache the last-good copy to disk so it keeps working through GitHub outages.
- Validate the fetched payload against [`local-models/v1/schema.json`](local-models/v1/schema.json) before use.
- Reject payloads whose top-level `schema_version` major exceeds what the consumer knows how to parse — that indicates a breaking schema change that requires a consumer update.
- Refresh periodically (15–60 min is a reasonable default).

## Catalog schema (at a glance)

Full source of truth: [`local-models/v1/schema.json`](local-models/v1/schema.json). Every row in `models[]` requires at minimum:

| Field           | Type   | Purpose                                                                             |
| --------------- | ------ | ----------------------------------------------------------------------------------- |
| `model_id`      | string | Stable per-model id. Ollama rows: the pull ref. Direct-GGUF rows: any stable string.|
| `display_name`  | string | What users see on the card.                                                         |
| `size_gb`       | number | Approx on-disk size for the recommended quant (usually Q4_K_M).                     |
| `min_ram_gb`    | number | Bare minimum RAM to load. Below this = the row shows up as `insufficient`.          |

Recommended additional fields (drive better hardware bucketing + filter chips):

| Field                 | Purpose                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `family`              | llama / qwen / gemma / phi / deepseek / ... — group + icon.        |
| `vendor`              | Publishing org.                                                    |
| `param_count_b`       | Parameter count in billions.                                       |
| `recommended_ram_gb`  | Comfortable inference RAM.                                         |
| `min_vram_gb`         | 0 = CPU-only viable.                                               |
| `recommended_vram_gb` | GPU offload target.                                                |
| `use_cases`           | Any of `chat`, `code`, `reasoning`, `embed`, `vision`.             |
| `notes`               | Free-form guidance shown beneath the card.                         |

If you want the model to be downloadable via a local llama.cpp-style runtime, add a `gguf` block:

```json
"gguf": {
  "repo_id": "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
  "filename": "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
  "sha256": null,
  "size_bytes": null,
  "quant": "Q4_K_M"
}
```

`sha256` + `size_bytes` are optional but strongly recommended — consumers use them for integrity verification and progress bars. Leave both as `null` until you have measured values against a pinned upstream version; `scripts/verify-hf-urls.mjs` in this repo will eventually populate them.

## Adding a model

1. **Fork + branch.** One model (or one coherent set) per PR.
2. **Pick a place in the array.** Rows are broadly sorted by ascending `size_gb`. Insert near your closest neighbor.
3. **Fill in the required fields** from the schema above. `param_count_b` and `size_gb` you can pull from the Hugging Face repo card; `min_ram_gb` follows the "~2x model size" rule for Q4 with headroom for KV cache.
4. **If you want direct-download support**, add the `gguf` block pointing at a real HF quant repo (bartowski, mradermacher, or a vendor-published GGUF repo). Filename must end in `.gguf`.
5. **Bump `_meta.catalog_version`** — convention `YYYY.MM.DD-N`. This is how consumers detect a rollout.
6. **Open the PR.** CI will:
   - Run `scripts/validate.mjs` (schema + duplicate ids) — hard fail on any issue.
   - Run `scripts/verify-hf-urls.mjs` (HEAD each HF URL) — warn on 4xx/5xx but does not block merge, since HF occasionally rate-limits.

## Deprecating a model

Remove the row, bump `_meta.catalog_version`. Users who already downloaded the weights keep them locally — the catalog only drives the *listings* page; consumers don't scrub disks.

If a model needs to be replaced (upstream repo renamed, quant maintainer moved), do the swap in a single PR: update `gguf.repo_id`/`filename`, null out `sha256`/`size_bytes`, note the change in the PR description.

## What this repo intentionally is *not*

- Not a **weights mirror.** GGUFs live on Hugging Face; we point at them in `local-models/v1`.
- Not a **cloud provider directory.** BYOK keys live in the consuming app.
- **Runtime vs model:** `local-runtimes/v1` pins inference *engines* (llama-server today). `local-models/v1` pins *model weights*. Same Eriador repo, two tracks. Future `deployment_recipes` for cloud/self-hosted bootstrap may join this repo as a third track.

## Security

- **Never commit secrets.** No API keys, tokens, passwords, private URLs, or private repo paths. Every file in this repo is world-readable.
- **Never point `gguf.repo_id` at a private repo.** Hugging Face URLs that require auth will break every consumer's download flow.
- If you notice something that looks like it shouldn't be public, open an issue immediately — don't wait for the PR round-trip.

## License

MIT. See [LICENSE](LICENSE).
