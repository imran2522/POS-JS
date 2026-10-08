// Guards the #1 offline bug: a file the app needs but the service worker forgot to precache.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const toFile = (url) => (url === '/' ? 'public/index.html' : url.startsWith('/shared/') ? url.slice(1) : 'public' + url);

const shell = [...read('public/sw.js').match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('every precached URL exists on disk', () => {
  for (const url of shell) assert.ok(fs.existsSync(path.join(root, toFile(url))), `missing: ${url}`);
});

test('every script the app imports is precached', () => {
  const needed = new Set();
  for (const f of fs.readdirSync(path.join(root, 'public')).filter((n) => n.endsWith('.js') && n !== 'sw.js')) {
    for (const m of read(`public/${f}`).matchAll(/from '([^']+)'/g)) {
      if (m[1].startsWith('./')) needed.add('/' + m[1].slice(2));
      else if (m[1].startsWith('../')) needed.add('/' + m[1].slice(3));
      else if (m[1].startsWith('/')) needed.add(m[1]);
    }
  }
  for (const url of needed) assert.ok(shell.includes(url), `not precached: ${url}`);
});

test('every asset the page references is precached', () => {
  for (const m of read('public/index.html').matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    assert.ok(shell.includes(m[1]), `not precached: ${m[1]}`);
  }
});
