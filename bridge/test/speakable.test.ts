import assert from 'node:assert/strict';
import { test } from 'node:test';
import { speakable } from '../src/speakable.ts';

test('plain text is kept', () => {
  assert.equal(speakable('Your meeting moved to 3 pm. Want me to tell Sam?'), 'Your meeting moved to 3 pm. Want me to tell Sam?');
});

test('code blocks and links are not read out', () => {
  assert.equal(
    speakable('Run this:\n```sh\nrm -rf build\n```\nSee [the docs](https://example.com/a_(b)) or https://example.com/x.'),
    'Run this: Code omitted. See the docs or link.',
  );
});

test('headings and list items become sentences, formatting marks go', () => {
  assert.equal(speakable('## Plan\n- **Buy** milk\n- Call _Sam_\n1. Done'), 'Plan. Buy milk. Call Sam. Done.');
});

test('underscores inside words stay', () => {
  assert.equal(speakable('Set my_var_name to 3.'), 'Set my_var_name to 3.');
});

test('tables are read row by row', () => {
  assert.equal(speakable('| Day | Task |\n|---|---|\n| Mon | Gym |'), 'Day, Task. Mon, Gym.');
});

test('emoji are dropped', () => {
  assert.equal(speakable('Done ✅ 🎉'), 'Done.');
});

test('inline code keeps its words', () => {
  assert.equal(speakable('Run `pnpm test` now.'), 'Run pnpm test now.');
});
