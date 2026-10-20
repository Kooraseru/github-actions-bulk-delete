// ==UserScript==
// @name         GitHub Actions Bulk Delete
// @namespace    kooraseru
// @author       kooraseru (https://github.com/Kooraseru)
// @version      0.8.1
// @description  Bulk-delete workflow runs using the GitHub session.
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
    const DELAY_MS = 500;

    const selected = new Set();

    let repoKey = '';
    let busy = false;
    let pending = false;

    const sleep = ms =>
        new Promise(resolve => setTimeout(resolve, ms));

    // Only positioning. GitHub owns the component appearance.
    const style = document.createElement('style');
    style.textContent = `
        .ghabd-row {
            position: relative !important;
            padding-left: 48px !important;
        }

        .ghabd-check {
            position: absolute !important;
            left: 16px !important;
            top: 50% !important;
            transform: translateY(-50%) !important;
            margin: 0 !important;
            width: 16px;
            height: 16px;
            cursor: pointer;
            z-index: 1;
        }

        #ghabd-controls {
            justify-content: flex-end;
            flex-wrap: wrap;
        }

        #ghabd-controls input[type="checkbox"] {
            margin: 0;
        }
    `;
    document.head.append(style);

    function context() {
        const parts = location.pathname.split('/').filter(Boolean);

        if (parts.length < 3 || parts[2] !== 'actions') {
            return null;
        }

        return {
            owner: parts[0],
            repo: parts[1],
            key: `${parts[0]}/${parts[1]}`
        };
    }

    function runId(row) {
        return row.querySelector(RUN_LINK)
            ?.getAttribute('href')
            ?.match(/\/actions\/runs\/(\d+)/)?.[1] ?? null;
    }

    function rows() {
        const list = document.querySelector(LIST);

        return list
            ? [...list.querySelectorAll(ROW)].filter(runId)
            : [];
    }

    function visibleIds() {
        return [...new Set(rows().map(runId))];
    }

    function say(message) {
        const element = document.getElementById('ghabd-status');
        if (element) element.textContent = message;
    }

    function makeButton(label) {
        const button = document.createElement('button');

        button.type = 'button';
        button.className = 'prc-Button-ButtonBase-9n-Xk';
        button.dataset.component = 'Button';
        button.dataset.size = 'medium';
        button.dataset.variant = 'danger';

        const content = document.createElement('span');
        content.className = 'prc-Button-ButtonContent-Iohp5';
        content.dataset.component = 'buttonContent';
        content.dataset.align = 'center';

        const text = document.createElement('span');
        text.className = 'prc-Button-Label-FWkx3';
        text.dataset.component = 'text';
        text.textContent = label;

        content.append(text);
        button.append(content);

        return button;
    }

    function update() {
        const button = document.getElementById('ghabd-delete');
        const selectAll = document.getElementById('ghabd-all');

        if (!button || !selectAll) return;

        const ids = visibleIds();
        const checked = ids.filter(id => selected.has(id)).length;

        const text = button.querySelector('[data-component="text"]');

        if (text) {
            text.textContent = selected.size
                ? `Delete selected (${selected.size})`
                : 'Delete selected';
        }

        button.disabled = busy || selected.size === 0;
        selectAll.disabled = busy;

        selectAll.checked =
            ids.length > 0 && checked === ids.length;

        selectAll.indeterminate =
            checked > 0 && checked < ids.length;

        for (const row of rows()) {
            const checkbox = row.querySelector('.ghabd-check');
            if (!checkbox) continue;

            checkbox.checked = selected.has(runId(row));
            checkbox.disabled = busy;
        }
    }

    function createControls(list) {
        if (document.getElementById('ghabd-controls')) {
            return;
        }

        const panel = document.createElement('div');
        panel.id = 'ghabd-controls';
        panel.className = 'd-flex flex-items-center gap-2 p-3';

        const label = document.createElement('label');
        label.className = 'd-inline-flex flex-items-center gap-2';

        const selectAll = document.createElement('input');
        selectAll.type = 'checkbox';
        selectAll.id = 'ghabd-all';

        label.append(
            selectAll,
            document.createTextNode('All on page')
        );

        selectAll.addEventListener('change', () => {
            for (const id of visibleIds()) {
                if (selectAll.checked) {
                    selected.add(id);
                } else {
                    selected.delete(id);
                }
            }

            update();
        });

        const button = makeButton('Delete selected');
        button.id = 'ghabd-delete';
        button.disabled = true;
        button.addEventListener('click', deleteSelected);

        const status = document.createElement('span');
        status.id = 'ghabd-status';
        status.className = 'color-fg-muted text-small';
        status.setAttribute('role', 'status');

        panel.append(label, button, status);
        list.before(panel);
    }

    function enhance() {
        const ctx = context();
        if (!ctx) return;

        if (ctx.key !== repoKey) {
            if (busy) return;

            selected.clear();
            repoKey = ctx.key;

            document.getElementById('ghabd-controls')?.remove();
        }

        const list = document.querySelector(LIST);
        if (!list) return;

        createControls(list);

        for (const row of rows()) {
            const id = runId(row);

            row.classList.add('ghabd-row');

            if (row.querySelector('.ghabd-check')) {
                continue;
            }

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'ghabd-check';
            checkbox.checked = selected.has(id);
            checkbox.disabled = busy;

            checkbox.setAttribute(
                'aria-label',
                `Select workflow run ${id}`
            );

            checkbox.addEventListener('click', event => {
                event.stopPropagation();
            });

            checkbox.addEventListener('keydown', event => {
                event.stopPropagation();
            });

            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selected.add(id);
                } else {
                    selected.delete(id);
                }

                update();
            });

            row.prepend(checkbox);
        }

        update();
    }

    // Authentication: existing GitHub session.
    // Never store or manually construct session cookies.
    function githubHeaders() {
        const nonce = document.querySelector(
            'meta[name="fetch-nonce"]'
        )?.content;

        if (!nonce) {
            throw new Error(
                'GitHub fetch nonce not found. Reload the page.'
            );
        }

        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'github-is-react': 'true',
            'github-verified-fetch': 'true',
            'x-fetch-nonce': nonce
        };

        // This value is supplied by GitHub's page metadata.
        const version = document.querySelector(
            'meta[name="release"]'
        )?.content;

        if (version) {
            headers['x-github-client-version'] = version;
        }

        return headers;
    }

    async function deleteRun(ctx, id) {
        if (!/^\d+$/.test(id)) {
            throw new Error('Invalid workflow run ID');
        }

        const path =
            `/${encodeURIComponent(ctx.owner)}/` +
            `${encodeURIComponent(ctx.repo)}/` +
            `actions/runs/${id}`;

        const response = await fetch(path, {
            method: 'DELETE',
            credentials: 'same-origin',
            mode: 'same-origin',
            redirect: 'error',
            cache: 'no-store',
            headers: githubHeaders(),
            body: JSON.stringify({})
        });

        if (!response.ok) {
            let message = `HTTP ${response.status}`;

            const body = await response.text();

            if (body) {
                try {
                    const json = JSON.parse(body);
                    message += `: ${json.message || json.error || response.statusText}`;
                } catch {
                    message += `: ${response.statusText}`;
                }
            }

            throw new Error(message);
        }

        // The observed native DELETE endpoint returns 200.
        // Fail closed if the response format changes.
        if (response.status !== 200 && response.status !== 204) {
            throw new Error(
                `Unexpected deletion response: HTTP ${response.status}`
            );
        }

        return true;
    }

    async function deleteSelected() {
        if (busy || !selected.size) return;

        const ctx = context();
        if (!ctx) return;

        const ids = [...selected];

        if (!confirm(
            `Permanently delete ${ids.length} workflow runs from ${ctx.key}?`
        )) {
            return;
        }

        busy = true;
        update();

        let deleted = 0;
        let stopped = false;

        try {
            for (let i = 0; i < ids.length; i++) {
                if (context()?.key !== ctx.key) {
                    stopped = true;
                    say('Stopped: repository changed.');
                    break;
                }

                const id = ids[i];
                say(`Deleting ${i + 1}/${ids.length}...`);

                try {
                    await deleteRun(ctx, id);

                    selected.delete(id);
                    deleted++;

                    for (const row of rows()) {
                        if (runId(row) === id) {
                            row.classList.add('color-fg-muted');
                        }
                    }
                } catch (error) {
                    console.error(
                        `[GitHub Actions Bulk Delete] Run ${id}:`,
                        error
                    );

                    stopped = true;
                    say(`Stopped at ${id}: ${error.message}`);
                    break;
                }

                update();

                if (i < ids.length - 1) {
                    await sleep(DELAY_MS);
                }
            }
        } finally {
            busy = false;
            update();

            if (!stopped) {
                say(`Deleted ${deleted}/${ids.length} runs.`);
            }

            if (deleted && context()?.key === ctx.key) {
                await sleep(1500);

                if (context()?.key === ctx.key) {
                    location.reload();
                }
            }
        }
    }

    const observer = new MutationObserver(mutations => {
        if (mutations.every(m =>
            m.target.nodeType === Node.ELEMENT_NODE &&
            (
                m.target.closest?.('#ghabd-controls') ||
                m.target.closest?.('.ghabd-check')
            )
        )) {
            return;
        }

        if (pending) return;

        pending = true;

        requestAnimationFrame(() => {
            pending = false;
            enhance();
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    enhance();
})();
