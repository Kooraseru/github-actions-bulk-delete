// ==UserScript==
// @name         GitHub Actions Bulk Delete
// @namespace    kooraseru
// @author       kooraseru (https://github.com/Kooraseru)
// @version      0.9.0
// @description  Select workflow runs across pages and delete them concurrently using your GitHub session.
// @match        https://github.com/*/*/actions*
// @updateURL    https://raw.githubusercontent.com/Kooraseru/github-actions-bulk-delete/main/github-actions-bulk-delete.user.js
// @downloadURL  https://raw.githubusercontent.com/Kooraseru/github-actions-bulk-delete/main/github-actions-bulk-delete.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const LIST = 'ul[class*="Items__"]';
    const ROW = 'li[class*="ListItem__"]';
    const RUN_LINK = 'a[href*="/actions/runs/"]';
    const MAX_CONCURRENT_DELETES = 8;
    const MAX_SCAN_PAGES = 400;

    // Keep per-repository state across GitHub's client-side navigation.
    // It cannot survive closing/reloading the tab, nor can in-flight requests.
    const repositories = new Map();
    let pending = false;

    const css = document.createElement('style');
    css.textContent = `
        .ghabd-toolbar-host { display: flex !important; align-items: center; flex-wrap: wrap; gap: 12px; }
        .ghabd-toolbar-host > form { flex: 1 1 320px; min-width: 200px; }
        #ghabd-controls { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        #ghabd-controls input[type="checkbox"] { margin: 0; }
        #ghabd-status { min-width: 120px; }
        .ghabd-row { position: relative !important; padding-left: 48px !important; }
        .ghabd-check { position: absolute !important; left: 16px !important; top: 50% !important;
            transform: translateY(-50%) !important; margin: 0 !important; width: 16px; height: 16px;
            cursor: pointer; z-index: 1; }
        .ghabd-row.ghabd-deleted { opacity: .55; }
        .ghabd-row.ghabd-deleted .ghabd-check { cursor: not-allowed; }
    `;
    document.head.append(css);

    function context() {
        const parts = location.pathname.split('/').filter(Boolean);
        if (parts.length < 3 || parts[2] !== 'actions') return null;
        const [owner, repo] = parts;
        return { owner, repo, key: `${owner}/${repo}` };
    }

    function state(ctx) {
        if (!repositories.has(ctx.key)) {
            repositories.set(ctx.key, {
                selected: new Set(), deleted: new Set(), busy: false, scanning: false,
                message: '', completed: 0, total: 0
            });
        }
        return repositories.get(ctx.key);
    }

    function runId(row) {
        return row.querySelector(RUN_LINK)?.getAttribute('href')
            ?.match(/\/actions\/runs\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
    }

    function rows() {
        const list = document.querySelector(LIST);
        return list ? [...list.querySelectorAll(ROW)].filter(runId) : [];
    }

    function visibleIds() {
        return [...new Set(rows().map(runId))];
    }

    function button(label, id, danger = false) {
        const node = document.createElement('button');
        node.id = id;
        node.type = 'button';
        node.className = 'prc-Button-ButtonBase-9n-Xk';
        node.dataset.component = 'Button';
        node.dataset.size = 'medium';
        node.dataset.variant = danger ? 'danger' : 'default';
        const content = document.createElement('span');
        content.className = 'prc-Button-ButtonContent-Iohp5';
        content.dataset.component = 'buttonContent';
        const text = document.createElement('span');
        text.className = 'prc-Button-Label-FWkx3';
        text.dataset.component = 'text';
        text.textContent = label;
        content.append(text);
        node.append(content);
        return node;
    }

    function show(ctx, message) {
        const s = state(ctx);
        s.message = message;
        if (context()?.key === ctx.key) {
            const status = document.getElementById('ghabd-status');
            if (status) status.textContent = message;
        }
    }

    function update() {
        const ctx = context();
        if (!ctx) return;
        const s = state(ctx);
        const panel = document.getElementById('ghabd-controls');
        if (!panel || panel.dataset.repo !== ctx.key) return;
        const ids = visibleIds().filter(id => !s.deleted.has(id));
        const count = ids.filter(id => s.selected.has(id)).length;
        const locked = s.busy || s.scanning;
        const all = panel.querySelector('#ghabd-all');
        all.checked = ids.length > 0 && count === ids.length;
        all.indeterminate = count > 0 && count < ids.length;
        all.disabled = locked || ids.length === 0;
        panel.querySelector('#ghabd-scan').disabled = locked;
        panel.querySelector('#ghabd-clear').disabled = locked || s.selected.size === 0;
        const remove = panel.querySelector('#ghabd-delete');
        remove.disabled = locked || s.selected.size === 0;
        remove.querySelector('[data-component="text"]').textContent =
            `Delete selected (${s.selected.size})`;
        panel.querySelector('#ghabd-status').textContent = s.message;
        for (const row of rows()) {
            const id = runId(row);
            const deleted = s.deleted.has(id);
            row.classList.toggle('ghabd-deleted', deleted);
            const input = row.querySelector('.ghabd-check');
            if (!input) continue;
            input.checked = !deleted && s.selected.has(id);
            input.disabled = locked || deleted;
            input.title = deleted ? 'Deleted' : `Select workflow run ${id}`;
        }
    }

    function toolbarAnchor(list) {
        const search = document.querySelector(
            'input[placeholder="Search runs"], input[aria-label="Search runs"], input[placeholder*="Search workflow"]'
        );
        const form = search?.closest('form');
        if (form?.parentElement && !list.contains(form)) {
            form.parentElement.classList.add('ghabd-toolbar-host');
            return { node: form, position: 'after' };
        }
        // A GitHub layout change must not put the controls inside the run list.
        return { node: list, position: 'before' };
    }

    function createControls(ctx, list) {
        const old = document.getElementById('ghabd-controls');
        if (old?.dataset.repo === ctx.key) return;
        old?.remove();
        const panel = document.createElement('div');
        panel.id = 'ghabd-controls';
        panel.dataset.repo = ctx.key;
        panel.className = 'd-flex flex-items-center gap-2';
        const label = document.createElement('label');
        label.className = 'd-inline-flex flex-items-center gap-2';
        const all = document.createElement('input');
        all.type = 'checkbox';
        all.id = 'ghabd-all';
        label.append(all, document.createTextNode('All on page'));
        all.addEventListener('change', () => {
            const s = state(ctx);
            for (const id of visibleIds()) {
                if (s.deleted.has(id)) continue;
                if (all.checked) s.selected.add(id);
                else s.selected.delete(id);
            }
            update();
        });
        const scan = button('Select all runs', 'ghabd-scan');
        scan.addEventListener('click', () => selectAllRuns(ctx));
        const clear = button('Clear', 'ghabd-clear');
        clear.addEventListener('click', () => {
            state(ctx).selected.clear();
            update();
        });
        const remove = button('Delete selected (0)', 'ghabd-delete', true);
        remove.addEventListener('click', () => deleteSelected(ctx));
        const status = document.createElement('span');
        status.id = 'ghabd-status';
        status.className = 'color-fg-muted text-small';
        status.setAttribute('role', 'status');
        panel.append(label, scan, clear, remove, status);
        const anchor = toolbarAnchor(list);
        if (anchor.position === 'after') anchor.node.after(panel);
        else anchor.node.before(panel);
    }

    function enhance() {
        const ctx = context();
        const list = document.querySelector(LIST);
        if (!ctx || !list) return;
        createControls(ctx, list);
        for (const row of rows()) {
            const id = runId(row);
            row.classList.add('ghabd-row');
            if (row.querySelector('.ghabd-check')) continue;
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'ghabd-check';
            input.setAttribute('aria-label', `Select workflow run ${id}`);
            input.addEventListener('click', event => event.stopPropagation());
            input.addEventListener('keydown', event => event.stopPropagation());
            input.addEventListener('change', () => {
                const s = state(ctx);
                if (s.deleted.has(id) || s.busy || s.scanning) return update();
                if (input.checked) s.selected.add(id);
                else s.selected.delete(id);
                update();
            });
            row.prepend(input);
        }
        update();
    }

    // Select the results of the current repository Actions view, including
    // additional pages and any active URL filters, using GitHub's same-origin HTML.
    async function selectAllRuns(ctx) {
        const s = state(ctx);
        if (s.busy || s.scanning) return;
        s.scanning = true;
        update();
        const ids = new Set();
        let pageSize = 0;
        try {
            for (let page = 1; page <= MAX_SCAN_PAGES; page++) {
                const url = new URL(location.href);
                if (context()?.key !== ctx.key) throw new Error('Repository changed');
                url.searchParams.set('page', String(page));
                show(ctx, `Scanning runs: page ${page} (${ids.size} found)...`);
                const response = await fetch(url, {
                    method: 'GET', credentials: 'same-origin', redirect: 'follow',
                    headers: { Accept: 'text/html' }, cache: 'no-store'
                });
                if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
                    throw new Error(`Could not read Actions page ${page} (HTTP ${response.status})`);
                }
                const returned = new URL(response.url);
                if (returned.origin !== location.origin ||
                    !returned.pathname.startsWith(`/${ctx.owner}/${ctx.repo}/actions`)) {
                    throw new Error('GitHub redirected the scan outside the repository');
                }
                const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
                const list = doc.querySelector(LIST);
                if (!list) {
                    if (page > 1) break;
                    throw new Error('GitHub did not return a readable Actions list');
                }
                const pageIds = [...new Set([...list.querySelectorAll(ROW)].map(runId).filter(Boolean))];
                if (pageIds.length === 0) break;
                if (page === 1) pageSize = pageIds.length;
                const count = ids.size;
                for (const id of pageIds) if (!s.deleted.has(id)) ids.add(id);
                if (ids.size === count) {
                    throw new Error('GitHub repeated a page; all runs could not be verified');
                }
                if (pageIds.length < pageSize) break;
                if (page === MAX_SCAN_PAGES) throw new Error('Too many pages; narrow the filter');
            }
            if (ids.size === 0) throw new Error('No workflow runs found');
            for (const id of ids) s.selected.add(id);
            show(ctx, `Selected ${ids.size} runs across all matching pages.`);
        } catch (error) {
            show(ctx, `Selection failed: ${error.message}`);
            console.error('[GitHub Actions Bulk Delete] Scan:', error);
        } finally {
            s.scanning = false;
            update();
        }
    }

    // GitHub's web DELETE endpoint uses the existing signed-in browser session.
    // No session cookies or personal access tokens are read or stored.
    function githubHeaders() {
        const nonce = document.querySelector('meta[name="fetch-nonce"]')?.content;
        if (!nonce) throw new Error('GitHub fetch nonce not found; reload the page');
        const headers = {
            Accept: 'application/json', 'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest', 'github-is-react': 'true',
            'github-verified-fetch': 'true', 'x-fetch-nonce': nonce
        };
        const version = document.querySelector('meta[name="release"]')?.content;
        if (version) headers['x-github-client-version'] = version;
        return headers;
    }

    async function deleteRun(ctx, id) {
        if (!/^\d+$/.test(id)) throw new Error('Invalid workflow run ID');
        const endpoint = `/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}/actions/runs/${id}`;
        const response = await fetch(endpoint, {
            method: 'DELETE', credentials: 'same-origin', mode: 'same-origin',
            redirect: 'error', cache: 'no-store', headers: githubHeaders(),
            body: JSON.stringify({})
        });
        if (!response.ok) {
            let detail = '';
            try {
                const body = await response.json();
                detail = body.message || body.error || '';
            } catch { /* GitHub may return an HTML error page. */ }
            throw new Error(`HTTP ${response.status}${detail ? ': ' + detail : ''}`);
        }
        if (response.status !== 200 && response.status !== 204) {
            throw new Error(`Unexpected deletion response HTTP ${response.status}`);
        }
    }

    async function deleteSelected(ctx) {
        const s = state(ctx);
        if (s.busy || s.scanning) return;
        const ids = [...s.selected].filter(id => !s.deleted.has(id));
        if (!ids.length || !confirm(`Permanently delete ${ids.length} workflow runs from ${ctx.key}?`)) return;
        s.busy = true;
        s.total = ids.length;
        s.completed = 0;
        update();
        let cursor = 0;
        let removed = 0;
        const failures = [];
        async function worker() {
            while (cursor < ids.length) {
                const id = ids[cursor++];
                try {
                    await deleteRun(ctx, id);
                    s.deleted.add(id);
                    s.selected.delete(id);
                    removed++;
                } catch (error) {
                    failures.push({ id, reason: error.message });
                    console.error(`[GitHub Actions Bulk Delete] Run ${id}:`, error);
                } finally {
                    s.completed++;
                    show(ctx, `Deleted ${removed}/${s.total}, completed ${s.completed}/${s.total}`);
                    update();
                }
            }
        }
        try {
            // Requests are actually concurrent, not separated by a fixed delay.
            await Promise.all(Array.from(
                { length: Math.min(MAX_CONCURRENT_DELETES, ids.length) }, () => worker()
            ));
            show(ctx, failures.length
                ? `Deleted ${removed}/${ids.length}; ${failures.length} failed and remain selected.`
                : `Deleted ${removed}/${ids.length}. Deleted rows remain visible.`);
        } finally {
            s.busy = false;
            update();
        }
    }

    const observer = new MutationObserver(changes => {
        if (changes.every(change =>
            change.target.nodeType === Node.ELEMENT_NODE &&
            change.target.closest?.('#ghabd-controls')
        )) return;
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; enhance(); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    enhance();
})();
