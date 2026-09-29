import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

test('all JavaScript files parse', async () => {
  const files = await readdir(path.join(root, 'js'), { recursive: true });
  const scripts = files.filter((file) => file.endsWith('.js'));
  assert.ok(scripts.length >= 20);
  for (const file of scripts) {
    const absolute = path.join(root, 'js', file);
    const source = await readFile(absolute, 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
  }
});

test('HTML includes the core workspace and valid local scripts', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<title>Browser DAW/);
  assert.match(html, /id="tp-play"/);
  assert.match(html, /id="grid-canvas"/);
  assert.match(html, /id="view-mixer"/);

  const sources = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(sources.length >= 20);
  await Promise.all(sources.map((source) => access(path.join(root, source))));
});
