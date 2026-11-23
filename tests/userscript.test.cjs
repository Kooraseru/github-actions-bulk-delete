'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(
  path.join(__dirname, '..', 'github-actions-bulk-delete.user.js'), 'utf8'
);
const first = script.indexOf('function scanRequest(ctx, view)');
const last = script.indexOf("    // GitHub's web DELETE endpoint uses", first);
assert.ok(first >= 0 && last > first, 'Current userscript must expose a REST discovery block');

function fixture(href, fetcher) {
  const location = { href, pathname: new URL(href).pathname };
  const ctx = { owner: 'Demo', repo: 'Repo', key: 'Demo/Repo' };
  const state = { selected: new Set(), deleted: new Set(), busy: false, scanning: false };
  const messages = [];
  const implementation = script.slice(first, last);
  const api = new Function('URL', 'location', 'state', 'update', 'fetch', 'show',
    'context', 'MAX_SCAN_PAGES', 'console',
    implementation + '\nreturn { scanRequest, selectAllRuns };'
  )(URL, location, () => state, () => {}, fetcher,
    (_ctx, value) => messages.push(value), () => ctx, 20, { error() {} });
  return { ...api, ctx, state, messages };
}

test('uses GitHub PageHeader after native actions with Primer ActionList markup', () => {
  assert.match(script, /actions\.append\(panel\)/);
  assert.match(script, /actions\.lastElementChild !== old/);
  assert.match(script, /prc-ActionList-ActionListContent-/);
  assert.match(script, /data-visibility-visible/);
  assert.doesNotMatch(script, /actions\.prepend\(panel\)/);
});

test('all-runs and individual-workflow listings have distinct endpoints', () => {
  const f = fixture('https://github.com/Demo/Repo/actions', async () => {
    throw Error('unexpected fetch');
  });
  assert.equal(f.scanRequest(f.ctx, new URL(f.ctx.key === 'Demo/Repo'
    ? 'https://github.com/Demo/Repo/actions' : '')).pathname,
    '/repos/Demo/Repo/actions/runs');
  const scoped = f.scanRequest(f.ctx,
    new URL('https://github.com/Demo/Repo/actions/workflows/build.yml?query=branch%3Asource'));
  assert.equal(scoped.pathname, '/repos/Demo/Repo/actions/workflows/build.yml/runs');
  assert.equal(scoped.searchParams.get('branch'), 'source');
  assert.equal(scoped.searchParams.get('per_page'), '100');
});

test('unrepresentable filters fail closed, never silently broaden selection', () => {
  const f = fixture('https://github.com/Demo/Repo/actions', async () => {});
  assert.throws(() => f.scanRequest(f.ctx,
    new URL('https://github.com/Demo/Repo/actions?query=unknown%3Avalue')),
  /Unsupported Actions search/);
  assert.throws(() => f.scanRequest(f.ctx,
    new URL('https://github.com/Demo/Repo/actions?random=42')),
  /Unsupported Actions filter/);
});

test('All Time selects 130 public runs over two REST pages, excluding deleted IDs', async () => {
  const calls = [];
  const f = fixture('https://github.com/Demo/Repo/actions/workflows/build.yml?query=branch%3Asource',
    async (url, options) => {
      calls.push({ url, options });
      const page = Number(new URL(url).searchParams.get('page'));
      const runs = page === 1
        ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))
        : Array.from({ length: 30 }, (_, i) => ({ id: i + 101 }));
      return { ok: true, json: async () => ({ total_count: 130, workflow_runs: runs }) };
    });
  f.state.deleted.add('4');
  await f.selectAllRuns(f.ctx);
  assert.equal(f.state.selected.size, 129);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.url.includes('/actions/workflows/build.yml/runs')));
  assert.ok(calls.every(c => c.url.includes('branch=source')));
  assert.ok(calls.every(c => c.options.credentials === 'omit'));
  assert.match(f.messages.at(-1), /Selected 129 runs/);
});

test('HTTP 403 on a later page leaves an empty, unchanged selection', async () => {
  const f = fixture('https://github.com/Demo/Repo/actions',
    async url => Number(new URL(url).searchParams.get('page')) === 1
      ? { ok: true, json: async () => ({
          total_count: 130,
          workflow_runs: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))
        }) }
      : { ok: false, status: 403, statusText: 'Forbidden',
          json: async () => ({ message: 'API rate limit exceeded' }) });
  await f.selectAllRuns(f.ctx);
  assert.equal(f.state.selected.size, 0);
  assert.match(f.messages.at(-1), /Selection failed: GitHub REST HTTP 403/);
});

test('empty workflow listings return a useful status, not a false failure', async () => {
  const f = fixture('https://github.com/Demo/Repo/actions', async () => ({
    ok: true, json: async () => ({ total_count: 0, workflow_runs: [] })
  }));
  await f.selectAllRuns(f.ctx);
  assert.equal(f.state.selected.size, 0);
  assert.equal(f.messages.at(-1), 'No runs in the current view.');
});
