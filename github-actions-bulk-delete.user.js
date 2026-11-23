// ==UserScript==
// @name         GitHub Actions Bulk Delete
// @namespace    kooraseru
// @author       kooraseru (https://github.com/Kooraseru)
// @version      0.9.3
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
        /* Only positioning: appearance comes from GitHub's native Primer CSS. */
        .ghabd-actions-host { display: flex !important; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
        #ghabd-controls { display: inline-flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; max-width: 100%; }
        #ghabd-select { position: relative; }
        #ghabd-select-menu { position: absolute !important; top: calc(100% + 4px); right: 0; z-index: 1000; min-width: 200px; }
        #ghabd-select-menu[hidden] { display: none !important; }
        #ghabd-status { max-width: 230px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .ghabd-row { position: relative !important; padding-left: 48px !important; }
        .ghabd-check { position: absolute !important; left: 16px !important; top: 50% !important;
            transform: translateY(-50%) !important; margin: 0 !important; width: 16px; height: 16px;
            cursor: pointer; z-index: 1; }
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
        const locked = s.busy || s.scanning;
        panel.querySelector('#ghabd-select-toggle').disabled = locked;
        panel.querySelector('#ghabd-select-page').disabled = locked || ids.length === 0;
        panel.querySelector('#ghabd-select-time').disabled = locked;
        panel.querySelector('#ghabd-select-time').title =
            `Select all runs in ${location.pathname.includes('/actions/workflows/') ? 'this workflow' : 'all workflows'} across all pages (honors current filters)`;
        if (locked) setMenuOpen(panel, false);
        panel.querySelector('#ghabd-clear').disabled = locked || s.selected.size === 0;
        const remove = panel.querySelector('#ghabd-delete');
        remove.disabled = locked || s.selected.size === 0;
        remove.querySelector('[data-component="text"]').textContent =
            `Delete selected (${s.selected.size})`;
        panel.querySelector('#ghabd-status').textContent = s.message;
        for (const row of rows()) {
            const id = runId(row);
            // React may briefly restore an old item during an auto-refresh.
            // A successful deletion must disappear immediately and stay gone.
            if (s.deleted.has(id)) {
                row.remove();
                continue;
            }
            const input = row.querySelector('.ghabd-check');
            if (!input) continue;
            input.checked = s.selected.has(id);
            input.disabled = locked;
            input.title = `Select workflow run ${id}`;
        }
    }

    function setMenuOpen(panel, open) {
        const menu = panel?.querySelector('#ghabd-select-menu');
        const toggle = panel?.querySelector('#ghabd-select-toggle');
        if (!menu || !toggle) return;
        menu.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
    }

    function selectVisible(ctx) {
        const s = state(ctx);
        if (s.busy || s.scanning) return;
        let count = 0;
        for (const id of visibleIds()) {
            if (s.deleted.has(id)) continue;
            s.selected.add(id);
            count++;
        }
        show(ctx, `Selected ${count} runs on this page.`);
        update();
    }

    function createControls(ctx) {
        // Never fall back to the results list: controls belong in GitHub's
        // PageHeader actions beside "New workflow", not under the filters.
        const actions = document.querySelector(
            'header[data-component="PageLayout.Header"] [data-component="PH_Actions"]'
        );
        if (!actions) return;
        const old = document.getElementById('ghabd-controls');
        if (old?.dataset.repo === ctx.key) {
            // A previously mounted panel may need relocating after a GitHub
            // client-side route change or header reconstruction.
            if (actions.lastElementChild !== old) actions.append(old);
            actions.classList.add('ghabd-actions-host');
            return;
        }
        old?.remove();
        const panel = document.createElement('div');
        panel.id = 'ghabd-controls';
        panel.dataset.repo = ctx.key;
        panel.className = 'd-flex flex-items-center gap-2';
        // One selection dropdown replaces the page checkbox and the separate
        // all-pages scan button. Both actions apply to the current Actions view.
        const chooser = document.createElement('div');
        chooser.id = 'ghabd-select';
        const toggle = button('Select runs', 'ghabd-select-toggle');
        toggle.setAttribute('aria-haspopup', 'menu');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', 'ghabd-select-menu');
        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        arrow.setAttribute('viewBox', '0 0 16 16');
        arrow.setAttribute('width', '16');
        arrow.setAttribute('height', '16');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.style.marginLeft = '6px';
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'm4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z');
        arrow.append(path);
        toggle.append(arrow);
        // Match the native Primer ActionMenu/ActionList markup supplied by GitHub.
        const menu = document.createElement('div');
        menu.id = 'ghabd-select-menu';
        menu.dataset.component = 'ActionMenu.Overlay';
        menu.className = 'prc-Overlay-Overlay-jfs-T';
        menu.setAttribute('role', 'none');
        menu.setAttribute('data-side', 'outside-bottom');
        menu.hidden = true;
        const container = document.createElement('div');
        container.className = 'prc-ActionMenu-ActionMenuContainer-Om1Qz';
        container.dataset.variant = 'anchored';
        const items = document.createElement('ul');
        items.dataset.component = 'ActionList';
        items.className = 'prc-ActionList-ActionList-rPFF2';
        items.setAttribute('role', 'menu');
        items.setAttribute('aria-labelledby', toggle.id);
        items.dataset.variant = 'inset';
        const option = (id, title, action) => {
            const li = document.createElement('li');
            li.dataset.component = 'ActionList.Item';
            li.className = 'prc-ActionList-ActionListItem-So4vC';
            li.setAttribute('role', 'none');
            const item = document.createElement('button');
            item.id = id;
            item.type = 'button';
            item.dataset.component = 'ActionList.Item.Button';
            item.dataset.size = 'medium';
            item.className = 'prc-ActionList-ActionListContent-KBb8-';
            item.setAttribute('role', 'menuitem');
            const spacer = document.createElement('span');
            spacer.className = 'prc-ActionList-Spacer-4tR2m';
            const sub = document.createElement('span');
            sub.className = 'prc-ActionList-ActionListSubContent-gKsFp';
            sub.dataset.component = 'ActionList.Item--DividerContainer';
            const text = document.createElement('span');
            text.className = 'prc-ActionList-ItemLabel-81ohH';
            text.dataset.component = 'ActionList.Item.Label';
            text.textContent = title;
            sub.append(text);
            item.append(spacer, sub);
            item.addEventListener('click', () => {
                setMenuOpen(panel, false);
                action();
            });
            li.append(item);
            items.append(li);
            return item;
        };
        option('ghabd-select-page', 'All on Page', () => selectVisible(ctx));
        option('ghabd-select-time', 'All Time', () => selectAllRuns(ctx));
        container.append(items);
        menu.append(container);
        toggle.addEventListener('click', () => {
            if (toggle.disabled) return;
            setMenuOpen(panel, menu.hidden);
            if (!menu.hidden) menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
        });
        chooser.append(toggle, menu);
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
        panel.append(chooser, clear, remove, status);
        actions.classList.add('ghabd-actions-host');
        actions.append(panel);
    }

    function enhance() {
        const ctx = context();
        const list = document.querySelector(LIST);
        if (!ctx || !list) return;
        createControls(ctx);
        for (const row of rows()) {
            const id = runId(row);
            if (state(ctx).deleted.has(id)) {
                row.remove();
                continue;
            }
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

    // Actions run lists are client-rendered; fetched HTML need not contain runs.
    // Use GitHub's official paginated workflow-runs REST endpoints instead.
    function scanRequest(ctx, view) {
        const prefix = `/${ctx.owner}/${ctx.repo}/actions`;
        if (!view.pathname.startsWith(prefix)) throw new Error('Not a repository Actions view');
        const suffix = view.pathname.slice(prefix.length);
        let endpoint = `/repos/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}/actions`;
        if (!suffix || suffix === '/') endpoint += '/runs';
        else {
            const workflow = /^\/workflows\/([^/]+)\/?$/.exec(suffix);
            if (!workflow) throw new Error('All Time requires a workflow-runs listing');
            endpoint += `/workflows/${encodeURIComponent(decodeURIComponent(workflow[1]))}/runs`;
        }
        const api = new URL(endpoint, 'https://api.github.com');
        api.searchParams.set('per_page', '100');
        const supported = new Set(['actor', 'branch', 'event', 'status', 'created', 'head_sha']);
        for (const [key, value] of view.searchParams) {
            if (key === 'page') continue;
            if (key === 'query') {
                const tokens = value.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
                for (const token of tokens) {
                    const match = /^([a-z_]+):(.+)$/.exec(token);
                    if (!match || !supported.has(match[1])) {
                        throw new Error(`Unsupported Actions search: ${token}`);
                    }
                    api.searchParams.set(match[1], match[2].replace(/^"|"$/g, ''));
                }
            } else if (supported.has(key)) api.searchParams.set(key, value);
            else throw new Error(`Unsupported Actions filter: ${key}`);
        }
        return api;
    }
    
    async function selectAllRuns(ctx) {
        const s = state(ctx);
        if (s.busy || s.scanning) return;
        const view = new URL(location.href);
        view.searchParams.delete('page');
        view.hash = '';
        let api;
        try { api = scanRequest(ctx, view); }
        catch (error) {
            show(ctx, `Selection failed: ${error.message}`);
            return;
        }
        s.scanning = true;
        update();
        const ids = new Set(), seen = new Set();
        try {
            for (let page = 1; page <= MAX_SCAN_PAGES; page++) {
                const current = new URL(location.href);
                current.searchParams.delete('page');
                current.hash = '';
                if (current.href !== view.href || context()?.key !== ctx.key) {
                    throw new Error('Actions view changed; selection cancelled');
                }
                const url = new URL(api.href);
                url.searchParams.set('page', String(page));
                show(ctx, `Scanning page ${page} (${ids.size} runs)...`);
                const response = await fetch(url.href, {
                    method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
                    headers: { Accept: 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28' }
                });
                if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    const detail = String(error.message || response.statusText || '').slice(0, 140);
                    throw new Error(`GitHub REST HTTP ${response.status}${detail ? ': ' + detail : ''}`);
                }
                const data = await response.json();
                if (!Number.isSafeInteger(data?.total_count) ||
                    !Array.isArray(data.workflow_runs)) {
                    throw new Error('Unexpected GitHub workflow-runs API response');
                }
                let added = 0;
                for (const run of data.workflow_runs) {
                    const id = String(run?.id ?? '');
                    if (!/^\d+$/.test(id)) throw new Error('Invalid workflow-run ID returned by GitHub');
                    if (!seen.has(id)) added++;
                    seen.add(id);
                    if (!s.deleted.has(id)) ids.add(id);
                }
                if (data.workflow_runs.length > 0 && added === 0) {
                    throw new Error('GitHub returned a repeated page');
                }
                if (seen.size >= data.total_count || data.workflow_runs.length === 0 ||
                    data.workflow_runs.length < 100) {
                    if (seen.size < data.total_count) {
                        throw new Error(`Incomplete scan (${seen.size}/${data.total_count}); narrow the filters`);
                    }
                    break;
                }
                if (page === MAX_SCAN_PAGES) throw new Error('Too many runs; narrow the filters');
            }
            for (const id of ids) s.selected.add(id);
            show(ctx, ids.size ? `Selected ${ids.size} runs in the current view.` : 'No runs in the current view.');
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
                    // Remove immediately rather than waiting for a page
                    // refresh. Off-page runs are remembered in s.deleted.
                    for (const row of rows()) {
                        if (runId(row) === id) row.remove();
                    }
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
                : `Deleted ${removed}/${ids.length}. Removed from list.`);
        } finally {
            s.busy = false;
            update();
        }
    }

    document.addEventListener('click', event => {
        const panel = document.getElementById('ghabd-controls');
        if (panel && !panel.querySelector('#ghabd-select')?.contains(event.target)) {
            setMenuOpen(panel, false);
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const panel = document.getElementById('ghabd-controls');
        if (panel?.querySelector('#ghabd-select-menu')?.hidden === false) {
            setMenuOpen(panel, false);
            panel.querySelector('#ghabd-select-toggle')?.focus();
        }
    });

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
