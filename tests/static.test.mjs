/* Checks on the static site that need no server: `node --test tests/static.test.mjs` */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const SUB = ['coach'];                                                   // folders with their own pages
const pages = [...readdirSync(ROOT).filter(f => f.endsWith('.html')), ...SUB.flatMap(d => readdirSync(join(ROOT, d)).filter(f => f.endsWith('.html')).map(f => d + '/' + f))];
const scripts = [...readdirSync(ROOT).filter(f => f.endsWith('.js')), ...SUB.flatMap(d => readdirSync(join(ROOT, d)).filter(f => f.endsWith('.js')).map(f => d + '/' + f))];
const read = f => readFileSync(join(ROOT, f), 'utf8');

test('no garbled characters (mojibake) on any page', () => {
  for (const p of pages) {
    const bad = read(p).match(/Ã.|â€|â†|Â[ ©·]|ðŸ/);
    assert.equal(bad, null, `${p} contains "${bad && bad[0]}"`);
  }
});

test('every local script, stylesheet and link target exists', () => {
  for (const p of pages) {
    for (const [, url] of read(p).matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)) {
      if (url.startsWith('//') || url.startsWith('mailto')) continue;
      assert.ok(existsSync(join(ROOT, p, '..', url)), `${p} → ${url} is missing`);
    }
  }
});

test('our scripts are cache-busted so visitors never mix old and new code', () => {
  for (const p of pages) {
    for (const [, url] of read(p).matchAll(/<script src="([^"]+)"/g)) {
      if (!/^https?:/.test(url)) assert.match(url, /\?v=\d+/, `${p} → ${url}`);
    }
  }
});

test('the voice pages allow what they need', () => {
  for (const p of ['index.html', 'clinic.html', 'coach/index.html']) {
    const csp = read(p).match(/Content-Security-Policy" content="([^"]+)"/)[1];
    for (const need of ['wss://generativelanguage.googleapis.com', 'https://*.workers.dev', 'https://challenges.cloudflare.com'])
      assert.ok(csp.includes(need), `${p}: CSP is missing ${need}`);
  }
});

test('the red-flag rules catch the development set (bench/data/triage.jsonl)', async () => {
  const { screen } = await import('../ai-worker/triage.js');
  const cases = read('bench/data/triage.jsonl').trim().split(/\r?\n/).map(l => JSON.parse(l));
  for (const c of cases.filter(c => c.level === 'emergency')) assert.equal(screen(c.text).level, 'emergency', `${c.id}: ${c.text}`);
  assert.equal(screen("I don't have chest pain, just a sore shoulder").level, 'routine');
});

test('no phone numbers or secrets in the public site', () => {
  for (const f of [...pages, ...scripts]) {
    const s = read(f);
    assert.doesNotMatch(s, /\b03\d{2}[- ]?\d{7}\b|\+92\s?3\d{2}/, `${f} has a Pakistani mobile number`);
    assert.doesNotMatch(s, /AIza[0-9A-Za-z_-]{30,}|AQ\.[A-Za-z0-9_-]{30,}|\d{9,10}:AA[A-Za-z0-9_-]{30,}/, `${f} has what looks like an API key or bot token`);
  }
});

test('all JavaScript parses', () => {
  const files = [...scripts, ...readdirSync(join(ROOT, 'ai-worker')).filter(f => f.endsWith('.js')).map(f => 'ai-worker/' + f), 'bench/run.mjs'];
  for (const f of files) execFileSync(process.execPath, ['--check', join(ROOT, f)]);
});
