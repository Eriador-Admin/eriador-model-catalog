#!/usr/bin/env node
/**
 * validate.mjs — schema + duplicate-id check for eriador-model-catalog.
 *
 * Zero-dependency: uses only Node stdlib (no ajv / no npm install). Any
 * consumer that fetches catalog.json is expected to run the equivalent
 * checks at load time; this script encodes them so PRs get fast
 * feedback in CI before shipping.
 *
 * Exit codes:
 *   0 — catalog validates cleanly.
 *   1 — any hard schema violation. CI blocks merge on this.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'local-models', 'v1', 'catalog.json');
const SCHEMA_PATH = path.join(REPO_ROOT, 'local-models', 'v1', 'schema.json');

/** Top-level fields the schema requires. */
const CATALOG_REQUIRED = ['schema_version', 'models'];

/** Per-row required fields. Same list schema.json enforces. */
const MODEL_REQUIRED = ['model_id', 'display_name', 'size_gb', 'min_ram_gb'];

/** Enum for use_cases[*]. Kept in sync with schema.json. */
const USE_CASE_ENUM = new Set(['chat', 'code', 'reasoning', 'embed', 'vision']);

/** Highest supported schema major. Bump when a required field changes
 *  shape or a required field is added — that's a breaking change and
 *  consumers on the old major will refuse the payload. */
const SUPPORTED_SCHEMA_MAJOR = 1;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`✓ ${msg}`);
}

function readJson(p, label) {
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    console.error(`FATAL: cannot read ${label} at ${p}: ${err.message}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`FATAL: ${label} is not valid JSON (${err.message})`);
    process.exit(1);
  }
}

const catalog = readJson(CATALOG_PATH, 'catalog.json');
const schema = readJson(SCHEMA_PATH, 'schema.json');

console.log(`Catalog: ${CATALOG_PATH}`);
console.log(`Schema:  ${SCHEMA_PATH}`);
console.log('');

// --- Top-level required fields --------------------------------------
for (const field of CATALOG_REQUIRED) {
  if (catalog[field] === undefined) {
    fail(`top-level: missing required field '${field}'`);
  } else {
    pass(`top-level: has '${field}'`);
  }
}

// --- Schema version --------------------------------------------------
if (typeof catalog.schema_version === 'string') {
  const [majorStr] = catalog.schema_version.split('.');
  const major = Number.parseInt(majorStr, 10);
  if (!Number.isFinite(major) || major < 1) {
    fail(`schema_version '${catalog.schema_version}' is not a valid semver major`);
  } else if (major > SUPPORTED_SCHEMA_MAJOR) {
    fail(
      `schema_version=${catalog.schema_version} is ahead of the max major `
      + `this validator (and current consumers) accept: SUPPORTED_SCHEMA_MAJOR=${SUPPORTED_SCHEMA_MAJOR}. `
      + 'Coordinate a consumer upgrade before merging.',
    );
  } else {
    pass(`schema_version=${catalog.schema_version} within supported range (major=${major}, max=${SUPPORTED_SCHEMA_MAJOR})`);
  }
}

// --- _meta.catalog_version present? (soft — warn only) ---------------
const catalogVersion = catalog?._meta?.catalog_version;
if (!catalogVersion) {
  console.warn('⚠ _meta.catalog_version is missing. CatalogStatusPanel will show \'—\'. Please add one (convention: YYYY.MM.DD-N).');
} else {
  pass(`_meta.catalog_version=${catalogVersion}`);
}

// --- Models array + per-row shape -----------------------------------
if (!Array.isArray(catalog.models)) {
  fail("'models' must be an array");
  process.exit(process.exitCode || 1);
}
if (catalog.models.length === 0) {
  fail("'models' must contain at least one row");
}

const seenIds = new Set();
const modelErrors = [];
catalog.models.forEach((m, idx) => {
  if (!m || typeof m !== 'object') {
    modelErrors.push(`models[${idx}] is not an object`);
    return;
  }
  for (const field of MODEL_REQUIRED) {
    if (m[field] === undefined || m[field] === null) {
      modelErrors.push(`models[${idx}] (${m.model_id || '?'}): missing required field '${field}'`);
    }
  }
  if (typeof m.model_id === 'string') {
    if (seenIds.has(m.model_id)) {
      modelErrors.push(`models[${idx}]: duplicate model_id '${m.model_id}'`);
    }
    seenIds.add(m.model_id);
  }
  // Numeric fields must be non-negative numbers.
  for (const numField of ['size_gb', 'min_ram_gb', 'recommended_ram_gb', 'min_vram_gb', 'recommended_vram_gb', 'param_count_b']) {
    if (m[numField] !== undefined && m[numField] !== null) {
      if (typeof m[numField] !== 'number' || m[numField] < 0 || Number.isNaN(m[numField])) {
        modelErrors.push(`models[${idx}] (${m.model_id}): '${numField}'=${JSON.stringify(m[numField])} must be a non-negative number`);
      }
    }
  }
  // use_cases enum
  if (m.use_cases !== undefined) {
    if (!Array.isArray(m.use_cases)) {
      modelErrors.push(`models[${idx}] (${m.model_id}): use_cases must be an array`);
    } else {
      for (const uc of m.use_cases) {
        if (!USE_CASE_ENUM.has(uc)) {
          modelErrors.push(`models[${idx}] (${m.model_id}): use_cases contains unknown value '${uc}'. Allowed: ${[...USE_CASE_ENUM].join(', ')}`);
        }
      }
    }
  }
  // gguf block shape (if present)
  if (m.gguf !== undefined) {
    const g = m.gguf;
    if (!g || typeof g !== 'object') {
      modelErrors.push(`models[${idx}] (${m.model_id}): gguf must be an object`);
    } else {
      if (typeof g.repo_id !== 'string' || !/^[^/]+\/[^/]+$/.test(g.repo_id)) {
        modelErrors.push(`models[${idx}] (${m.model_id}): gguf.repo_id must look like 'org/repo', got ${JSON.stringify(g.repo_id)}`);
      }
      if (typeof g.filename !== 'string' || !g.filename.endsWith('.gguf')) {
        modelErrors.push(`models[${idx}] (${m.model_id}): gguf.filename must end in .gguf, got ${JSON.stringify(g.filename)}`);
      }
      if (g.sha256 !== null && g.sha256 !== undefined) {
        if (typeof g.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(g.sha256)) {
          modelErrors.push(`models[${idx}] (${m.model_id}): gguf.sha256 must be a 64-char lowercase hex digest or null`);
        }
      }
      if (g.size_bytes !== null && g.size_bytes !== undefined) {
        if (!Number.isInteger(g.size_bytes) || g.size_bytes < 0) {
          modelErrors.push(`models[${idx}] (${m.model_id}): gguf.size_bytes must be a non-negative integer or null`);
        }
      }
    }
  }
});

if (modelErrors.length) {
  for (const e of modelErrors) fail(e);
} else {
  pass(`${catalog.models.length} models — all rows validate`);
}

// --- Summary --------------------------------------------------------
console.log('');
console.log(`Catalog version: ${catalogVersion || '(unset)'}`);
console.log(`Model count:     ${catalog.models.length}`);
console.log(`Unique model_ids: ${seenIds.size}`);

if (process.exitCode === 1) {
  console.error('');
  console.error('validate: FAIL');
  process.exit(1);
}
console.log('');
console.log('validate: PASS');
