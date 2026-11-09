/* Checks on the static site that need no server: `node --test tests/static.test.mjs` */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const pages = readdirSync(ROOT).filter(f => f.endsWith('.html'));
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
      assert.ok(existsSync(join(ROOT, url)), `${p} → ${url} is missing`);
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

test('the voice assistant page allows what it needs (and nothing to frame it)', () => {
  const csp = read('index.html').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  for (const need of ['wss://generativelanguage.googleapis.com', 'https://*.workers.dev', 'https://challenges.cloudflare.com'])
    assert.ok(csp.includes(need), 'CSP is missing ' + need);
});

test('no phone numbers or secrets in the public site', () => {
  for (const f of [...pages, ...readdirSync(ROOT).filter(f => f.endsWith('.js'))]) {
    const s = read(f);
    assert.doesNotMatch(s, /\b03\d{2}[- ]?\d{7}\b|\+92\s?3\d{2}/, `${f} has a Pakistani mobile number`);
    assert.doesNotMatch(s, /AIza[0-9A-Za-z_-]{30,}|AQ\.[A-Za-z0-9_-]{30,}|\d{9,10}:AA[A-Za-z0-9_-]{30,}/, `${f} has what looks like an API key or bot token`);
  }
});

test('all JavaScript parses', () => {
  const files = [...readdirSync(ROOT).filter(f => f.endsWith('.js')), ...readdirSync(join(ROOT, 'ai-worker')).filter(f => f.endsWith('.js')).map(f => 'ai-worker/' + f)];
  for (const f of files) execFileSync(process.execPath, ['--check', join(ROOT, f)]);
});
