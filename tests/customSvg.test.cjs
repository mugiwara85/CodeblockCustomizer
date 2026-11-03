/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test file, same as wrapping.test.cjs. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const Module = require('node:module');
const path = require('node:path');

function loadCustomSvg() {
  const result = esbuild.buildSync({ entryPoints: ['src/CustomSvg.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
  const mod = new Module(path.join(process.cwd(), 'customSvg-test.cjs'), module);
  mod.filename = path.join(process.cwd(), 'customSvg-test.cjs');
  mod._compile(result.outputFiles[0].text, mod.filename);
  return mod.exports;
}
const { buildSvg, svgToDataUri } = loadCustomSvg();
const WRAPPER_START = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32">';
const wrapped = content => `${WRAPPER_START}${content}</svg>`;

test('content without <svg> tag is wrapped in the 32x32 box (old format, unchanged)', () => {
  assert.equal(buildSvg('<path d="M1 1h30v30H1z"/>'), wrapped('<path d="M1 1h30v30H1z"/>'));
});

test('complete SVG is nested in the 32x32 box and keeps its own viewBox', () => {
  const input = '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Caddy</title><path d="M0 0h24v24H0z"/></svg>';
  assert.equal(buildSvg(input), wrapped(input));
  assert.equal(buildSvg(`\n  ${input}\n`), wrapped(input));
});

test('XML declaration, comment and DOCTYPE are removed, fixed width/height is removed from the root tag only', () => {
  const input = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Inkscape -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg width="48mm" height=\'48mm\' viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" stroke-width="2"/></svg>';
  assert.equal(buildSvg(input), wrapped('<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" stroke-width="2"/></svg>'));
});

test('data URI handles non Latin-1 characters that btoa() rejects', () => {
  const svg = buildSvg('<svg viewBox="0 0 24 24"><title>© Ünïcødé ✓</title></svg>');
  assert.throws(() => btoa(svg));
  const uri = svgToDataUri(svg);
  assert.ok(uri.startsWith('data:image/svg+xml;charset=utf-8,'));
  assert.equal(decodeURIComponent(uri.slice(uri.indexOf(',') + 1)), svg);
});
