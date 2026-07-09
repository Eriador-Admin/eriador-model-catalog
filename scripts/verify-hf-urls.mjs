#!/usr/bin/env node
/**
 * verify-hf-urls.mjs — reachability check for gguf-block Hugging Face URLs.
 *
 * For every row in catalog.json that carries a `gguf` block, HEADs the
 * derived Hugging Face download URL and reports its status. Prints a
 * summary at the end.
 *
 * Zero-dependency: fetch is built into Node 18+.
 *
 * Exit codes:
 *   0 — no hard errors. This script is warn-only in CI; a 404 or 5xx
 *       does not block merge (HF sometimes 429s under load, and repos
 *       can temporarily go private during a re-upload).
 *   Non-zero — argv / catalog-load failure. The `--strict` flag makes
 *       any non-2xx response also fail.
 *
 * Flags:
 *   --strict      Fail (exit 1) if any URL returns non-2xx. Off by default.
 *   --timeout=ms  Per-URL fetch timeout. Default 8000.
 *   --concurrency=N  Max parallel HEAD requests. Default 6.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'local-models', 'v1', 'catalog.json');

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const timeoutMs = Number(argv.find((a) => a.startsWith('--timeout='))?.split('=')[1]) || 8000;
const concurrency = Number(argv.find((a) => a.startsWith('--concurrency='))?.split('=')[1]) || 6;

function loadCatalog() {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  } catch (err) {
    console.error(`FATAL: cannot load ${CATALOG_PATH}: ${err.message}`);
    process.exit(2);
  }
}

function hfResolveUrl({ repo_id, filename }) {
  return `https://huggingface.co/${repo_id}/resolve/main/${encodeURIComponent(filename)}`;
}

async function head(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'eriador-model-catalog/verify-hf-urls' },
    });
    return {
      ok: resp.ok,
      status: resp.status,
      contentLength: Number(resp.headers.get('content-length')) || null,
      etag: resp.headers.get('etag') || null,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      contentLength: null,
      etag: null,
      latencyMs: Date.now() - started,
      error: err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(items, worker, poolSize) {
  const results = new Array(items.length);
  let cursor = 0;
  async function step() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: poolSize }, () => step()));
  return results;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

const catalog = loadCatalog();
const targets = [];
for (const m of catalog.models) {
  if (m.gguf && typeof m.gguf.repo_id === 'string' && typeof m.gguf.filename === 'string') {
    targets.push({
      model_id: m.model_id,
      repo_id: m.gguf.repo_id,
      filename: m.gguf.filename,
      declared_size: m.gguf.size_bytes || null,
      url: hfResolveUrl(m.gguf),
    });
  }
}

console.log(`verify-hf-urls: catalog=${CATALOG_PATH}`);
console.log(`verify-hf-urls: ${catalog.models.length} models total, ${targets.length} with gguf pointer`);
console.log(`verify-hf-urls: concurrency=${concurrency} timeout=${timeoutMs}ms strict=${strict}`);
console.log('');

const results = await runPool(targets, async (t) => {
  const r = await head(t.url);
  return { ...t, ...r };
}, concurrency);

let okCount = 0;
let failCount = 0;
const failures = [];
for (const r of results) {
  const marker = r.ok ? '✓' : '✗';
  const sizeStr = r.contentLength
    ? `${(r.contentLength / (1024 ** 3)).toFixed(2)} GiB`
    : '?';
  const line = `${marker} ${pad(r.model_id, 30)} ${pad(String(r.status || 'ERR'), 4)} ${pad(sizeStr, 11)} ${r.latencyMs}ms  ${r.url}`;
  console.log(line);
  if (r.ok) {
    okCount += 1;
    if (r.declared_size && r.contentLength && r.declared_size !== r.contentLength) {
      console.warn(`  ⚠ declared size_bytes=${r.declared_size} but HF reports content-length=${r.contentLength}`);
    }
  } else {
    failCount += 1;
    failures.push({ model_id: r.model_id, url: r.url, status: r.status, error: r.error });
  }
}

console.log('');
console.log(`Reachable:   ${okCount}`);
console.log(`Unreachable: ${failCount}`);

if (failCount > 0) {
  console.log('');
  console.log('Unreachable URLs:');
  for (const f of failures) {
    console.log(`  - [${f.model_id}] status=${f.status} error=${f.error || '(none)'}  ${f.url}`);
  }
  if (strict) {
    console.error('');
    console.error('verify-hf-urls: FAIL (--strict + at least one non-2xx)');
    process.exit(1);
  }
  console.warn('');
  console.warn('verify-hf-urls: PASS (warn-only). Re-run with --strict to gate merge on this.');
}
