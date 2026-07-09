# Contributing to eriador-model-catalog

Thanks for wanting to add a model. This is a small repo with a strict schema — the goal is that every merged PR ships cleanly to every consumer within its next refresh cycle. Please follow the checklist below.

## Security — read this first

**Every file in this repo is public.** Before opening a PR, verify your diff contains **none** of the following:

- API keys, access tokens, refresh tokens, or Bearer strings.
- Passwords or SSH keys of any kind.
- Private repo URLs, internal hostnames, IP addresses, or non-public S3 / GCS / Azure URLs.
- Personal email addresses or contact info that shouldn't be public.
- Copyrighted or proprietary training data snippets.

If you notice something that looks like it shouldn't be public, open an issue instead of a PR so we can rotate the credential before it hits git history.

## PR checklist

- [ ] Only one model (or one coherent family / size set) per PR.
- [ ] Row inserted near its closest size neighbor in `local-models/v1/catalog.json`.
- [ ] Required fields present: `model_id`, `display_name`, `size_gb`, `min_ram_gb`.
- [ ] `param_count_b` matches the vendor's stated parameter count.
- [ ] `size_gb` matches the recommended-quant `.gguf` size (usually Q4_K_M).
- [ ] `min_ram_gb` follows the "~2x model size" rule for Q4 with KV-cache headroom.
- [ ] `use_cases` set to one or more of `chat` / `code` / `reasoning` / `embed` / `vision`.
- [ ] If direct-download support is desired: `gguf.repo_id` + `gguf.filename` point at a real, publicly-accessible HF quant repo (no gated / private repos).
- [ ] `_meta.catalog_version` bumped (`YYYY.MM.DD-N`).
- [ ] `_meta.last_updated` bumped to today.
- [ ] PR description explains **why** the model is worth adding (what use case does it fill, what did it replace, or where does it slot on the size/quality curve).

## Rules of thumb

**Which quant?** Q4_K_M is the default. Higher quants (Q5_K_M, Q6_K, Q8_0) can be added as separate rows if the community wants them, but the default row should stay Q4_K_M to keep the "recommended for your hardware" bucketing predictable.

**Which HF repo?** In rough priority order:

1. The vendor's own GGUF repo, if they publish one (Microsoft, Google, Meta, Moonshot AI often do).
2. `bartowski/...` — reliable community maintainer with per-quant files.
3. `mradermacher/...` — good coverage of long-tail models.
4. Anything else — please note in the PR why you picked it.

**Filename?** Must end in `.gguf`. Prefer the exact filename that would come out of `huggingface-cli download`.

**sha256 / size_bytes?** Leave as `null` unless you have measured them against a pinned upstream version. A future automated job will populate them from `scripts/verify-hf-urls.mjs`; hardcoding without measurement breaks integrity verification the moment HF republishes a file.

## When to bump the *schema* version (rare)

Only bump `schema_version` (top-level + `_meta.schema_version`) when a **required** field changes shape or a new **required** field is added. Optional additions (new optional fields, new enum values in `use_cases`) do not require a schema bump.

Bumping the schema major is a breaking change: any consumer reading with an older max-supported major will refuse the payload and stay on its previous cache. Coordinate with active consumers before merging a major bump.

## CI

Every push and PR runs `.github/workflows/validate.yml`:

- `node scripts/validate.mjs` — schema + duplicate-id check. **Hard fail on any issue.**
- `node scripts/verify-hf-urls.mjs` — HEAD every `gguf` URL. **Warn on 4xx/5xx** but does not block merge (HF sometimes rate-limits).

You can run both locally:

```bash
node scripts/validate.mjs
node scripts/verify-hf-urls.mjs
```

Both are zero-dependency Node scripts (no `npm install` required).
