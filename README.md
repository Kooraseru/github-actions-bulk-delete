<div align="center">
  <h1>GitHub Actions Bulk Delete</h1>
</div>

Select and delete workflow runs concurrently from a repository's GitHub Actions page. No personal access token is required – requests use your existing signed-in GitHub browser session.

## Installation

Requires a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/).

[Install GitHub Actions Bulk Delete](https://github.com/Kooraseru/github-actions-bulk-delete/raw/refs/heads/main/github-actions-bulk-delete.user.js)

Automatic updates use the userscript's `@updateURL` and `@downloadURL`; the current version is **0.9.3**.

## Usage

The controls appear at the right end of GitHub's page-header actions, **after New workflow or Run workflow**. The selection dropdown uses GitHub's native Primer ActionMenu and ActionList styling rather than a custom color scheme.

- **Select runs ▾ → All on Page:** Select only the runs currently displayed on this page.
- **Select runs ▾ → All Time:** Use GitHub's documented, paginated workflow-runs REST API to select available runs across the current view. On an individual workflow page it selects runs for **that workflow only**; on **All workflows** it selects across all workflows. Supported URL filters (branch, actor, event, status, created date, and SHA) are preserved. Unknown filters and incomplete scans fail closed, never silently broadening a deletion selection.
- **Clear:** Uncheck the current selection without deleting anything.
- **Delete selected:** Confirm the total once, then send up to **8 concurrent DELETE requests**. GitHub provides a per-run deletion endpoint, not an atomic bulk-delete request.

Individual deletions succeed or fail independently. Successfully deleted rows are **removed from the visible list immediately** without reloading the page; their IDs are remembered during the session to suppress stale rows restored by GitHub's auto-refresh. Failed deletions remain visible and selected for retry. Selecting runs across pages does not load those rows into the current list – only the current page's rows are displayed.

Selection and deletion state are held per repository during the current page session. It is not persisted to disk.

## Background execution

**Concurrency is not durable background execution.** Multiple deletion requests can run simultaneously while the tab remains open, including when it is in the background. Closing or fully navigating away from the page may cancel outstanding requests, and the userscript has no ability to guarantee their completion. Guaranteed unattended cleanup requires a separate server-side GitHub Actions job with appropriate repository permissions.

## Compatibility and safety

The userscript depends on GitHub's rendered Actions list, Primer classes, the page's `fetch-nonce`, and GitHub's internal web deletion endpoint. **All Time** uses GitHub's public REST API, not scraped HTML. The page structure and internal DELETE endpoint are not stable public APIs; a layout or authentication change can still break the UI or deletion.

**All Time currently supports public repositories without a token.** GitHub's unauthenticated API rate limits apply; scanning private repositories would require an explicit authentication mechanism and is not silently attempted. **All on Page** and deletion use your existing GitHub web session.

The implementation deliberately fails closed on unreadable API results, unsupported filters, incomplete scans, and unsupported HTTP deletion responses. It does not collect or save session cookies, ask for a PAT, or change workflow definitions. Deleting a workflow run is permanent and removes its logs and artifacts. Use a disposable run to confirm that deletion still works against the live GitHub UI before deleting large batches.

The prior browser flows were tested in headless Chromium with mocked responses. Version 0.9.3's REST scanner was additionally checked against mocked paginated responses (including an incomplete HTTP 403 result), and its source includes regression tests in `tests/userscript.test.cjs`. Run them using `node --test tests/userscript.test.cjs`. The authenticated live GitHub endpoint has not been tested here.

## License

Distributed under the ISC License. [LICENSE](LICENSE).
