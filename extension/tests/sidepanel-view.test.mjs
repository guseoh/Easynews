import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';

const code = buildSync({ entryPoints: ['src/sidepanel-view.ts'], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
const module = { exports: {} };
runInNewContext(code, { module, exports: module.exports });
const { themePreference, resolveTheme, nextTabIndex, relatedGroupState } = module.exports;

test('theme preference follows system until the user chooses an explicit theme', () => {
  assert.equal(themePreference(undefined), 'system');
  assert.equal(themePreference('unexpected'), 'system');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('tab keyboard navigation wraps and supports Home/End', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 2), 1);
  assert.equal(nextTabIndex('ArrowRight', 1, 2), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 2), 1);
  assert.equal(nextTabIndex('Home', 1, 2), 0);
  assert.equal(nextTabIndex('End', 0, 2), 1);
  assert.equal(nextTabIndex('Enter', 0, 2), undefined);
  assert.equal(nextTabIndex('ArrowRight', 0, 0), undefined);
});

test('related news empty states distinguish no results from a missing group', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(relatedGroupState(0, 0))), {
    showCombinedEmpty: true, showFollowUpEmpty: false, showBackgroundEmpty: false,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(relatedGroupState(2, 0))), {
    showCombinedEmpty: false, showFollowUpEmpty: false, showBackgroundEmpty: true,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(relatedGroupState(0, 3))), {
    showCombinedEmpty: false, showFollowUpEmpty: true, showBackgroundEmpty: false,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(relatedGroupState(2, 3))), {
    showCombinedEmpty: false, showFollowUpEmpty: false, showBackgroundEmpty: false,
  });
});
