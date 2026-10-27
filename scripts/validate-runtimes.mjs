#!/usr/bin/env node
/**
 * validate-runtimes.mjs — schema check for local-runtimes/v1/runtime-catalog.json
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'local-runtimes', 'v1', 'runtime-catalog.json');
const SCHEMA_PATH = path.join(REPO_ROOT, 'local-runtimes', 'v1', 'schema.json');

const CATALOG_REQUIRED = ['schema_version', 'runtimes'];
const RUNTIME_REQUIRED = ['runtime_key', 'display_name', 'release_tag', 'server_binary', 'platforms'];
const ARTIFACT_REQUIRED = ['asset_name', 'download_url', 'archive'];
const ARCHIVE_ENUM = new Set(['zip', 'tar.gz']);
const SUPPORTED_SCHEMA_MAJOR = 1;
const EXPECTED_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'];

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

const catalog = readJson(CATALOG_PATH, 'runtime-catalog.json');

console.log(`Runtime catalog: ${CATALOG_PATH}`);
console.log('');

for (const field of CATALOG_REQUIRED) {
  if (catalog[field] === undefined) fail(`top-level: missing '${field}'`);
  else pass(`top-level: has '${field}'`);
}

if (typeof catalog.schema_version === 'string') {
  const major = Number.parseInt(catalog.schema_version.split('.')[0], 10);
  if (!Number.isFinite(major) || major > SUPPORTED_SCHEMA_MAJOR) {
    fail(`schema_version=${catalog.schema_version} not supported (max major ${SUPPORTED_SCHEMA_MAJOR})`);
  } else {
    pass(`schema_version=${catalog.schema_version} ok`);
  }
}

if (!Array.isArray(catalog.runtimes) || catalog.runtimes.length === 0) {
  fail('runtimes must be a non-empty array');
} else {
  pass(`runtimes: ${catalog.runtimes.length} row(s)`);
}

const keys = new Set();
for (let i = 0; i < (catalog.runtimes || []).length; i += 1) {
  const row = catalog.runtimes[i];
  const prefix = `runtimes[${i}]`;
  for (const field of RUNTIME_REQUIRED) {
    if (row?.[field] === undefined) fail(`${prefix}: missing '${field}'`);
  }
  if (row?.runtime_key) {
    if (keys.has(row.runtime_key)) fail(`duplicate runtime_key '${row.runtime_key}'`);
    keys.add(row.runtime_key);
  }
  const platforms = row?.platforms;
  if (platforms && typeof platforms === 'object') {
    for (const pk of Object.keys(platforms)) {
      const art = platforms[pk];
      const ap = `${prefix}.platforms.${pk}`;
      for (const field of ARTIFACT_REQUIRED) {
        if (art?.[field] === undefined) fail(`${ap}: missing '${field}'`);
      }
      if (art?.archive && !ARCHIVE_ENUM.has(art.archive)) {
        fail(`${ap}: archive '${art.archive}' not in ${[...ARCHIVE_ENUM].join(', ')}`);
      }
      if (art?.download_url && !/^https:\/\//.test(art.download_url)) {
        fail(`${ap}: download_url must be https`);
      }
      if (art?.asset_name && art?.download_url && !art.download_url.includes(art.asset_name)) {
        console.warn(`⚠ ${ap}: download_url does not contain asset_name (may still be valid)`);
      }
    }
  }
}

const llama = catalog.runtimes?.find((r) => r.runtime_key === 'llama_cpp');
if (!llama) {
  fail("missing required runtime_key 'llama_cpp'");
} else {
  pass("has runtime_key 'llama_cpp'");
  for (const pk of EXPECTED_PLATFORMS) {
    if (!llama.platforms?.[pk]) fail(`llama_cpp.platforms missing '${pk}'`);
    else pass(`llama_cpp.platforms has '${pk}'`);
  }
}

if (process.exitCode) {
  console.error('\nvalidate-runtimes: FAILED');
  process.exit(1);
}
console.log('\nvalidate-runtimes: PASS');
