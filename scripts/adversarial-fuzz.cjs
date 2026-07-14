'use strict';

const assert = require('node:assert/strict');
const { parseAchDocument } = require('../out/achDocument.js');
const { parseAch } = require('../out/nachaParser.js');
const { standardAchFile } = require('../out/test/fixtures/achFixtures.js');

let state = 0x4e414348;
function random() {
  state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
  return state / 0x1_0000_0000;
}

function randomText() {
  const lineCount = Math.floor(random() * 25);
  const lines = [];
  const characters = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()\t😀';
  for (let line = 0; line < lineCount; line++) {
    const width = Math.floor(random() * 130);
    let value = '';
    for (let column = 0; column < width; column++) {
      const index = Math.floor(random() * characters.length);
      value += characters[index];
    }
    lines.push(value);
  }
  return lines.join(random() < 0.5 ? '\n' : '\r\n');
}

function assertRanges(text, diagnostics) {
  const document = parseAchDocument(text);
  for (const diagnostic of diagnostics) {
    assert.ok(diagnostic.line >= 0 && diagnostic.line < document.lines.length, `${diagnostic.code}: invalid line`);
    const width = document.lines[diagnostic.line].length;
    assert.ok(diagnostic.start >= 0 && diagnostic.start <= width, `${diagnostic.code}: invalid start`);
    assert.ok(diagnostic.end >= diagnostic.start && diagnostic.end <= width, `${diagnostic.code}: invalid end`);
    assert.ok([0, 1, 2, 3].includes(diagnostic.severity), `${diagnostic.code}: invalid severity`);
    for (const related of diagnostic.related ?? []) {
      assert.ok(related.line >= 0 && related.line < document.lines.length, `${diagnostic.code}: invalid related line`);
      const relatedWidth = document.lines[related.line].length;
      assert.ok(related.start >= 0 && related.start <= relatedWidth, `${diagnostic.code}: invalid related start`);
      assert.ok(related.end >= related.start && related.end <= relatedWidth, `${diagnostic.code}: invalid related end`);
    }
  }
}

for (let iteration = 0; iteration < 20_000; iteration++) {
  const text = randomText();
  assertRanges(text, parseAch(text));
}

const baseline = parseAch(standardAchFile()).map(diagnostic => diagnostic.code).sort();
for (const text of [standardAchFile('\r\n'), `${standardAchFile()}\n`, `${standardAchFile('\r\n')}\r\n`]) {
  assert.deepEqual(parseAch(text).map(diagnostic => diagnostic.code).sort(), baseline);
}

process.stdout.write('Adversarial validator fuzzing passed: 20,000 malformed inputs plus LF/CRLF invariants.\n');
