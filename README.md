<div align="center">
  <h1>GitHub Actions Bulk Delete</h1>
</div>

Select and delete workflow runs concurrently from a repository's GitHub Actions page. No personal access token is required – requests use your existing signed-in GitHub browser session.

## Installation

Requires a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/).

[Install GitHub Actions Bulk Delete](https://github.com/Kooraseru/github-actions-bulk-delete/raw/refs/heads/main/github-actions-bulk-delete.user.js)

Automatic updates use the userscript's `@updateURL` and `@downloadURL`; the current version is **0.9.4**.

## Usage

The controls appear at the right end of GitHub's page-header actions, **after New workflow or Run workflow**. The selection dropdown uses GitHub's Primer ActionMenu and ActionList styling, with the chevron positioned after the label.

- **Select runs ▾ → All on Page:** Select only the runs currently displayed on this page.
- **Select runs ▾ → All Time:** Use GitHub's documented, paginated workflow-runs REST API to select available runs across the current view. On an individual workflow page it selects runs for **that workflow only**; on **All workflows** it selects across all workflows. Supported URL filters (branch, actor, event, status, created date, and SHA) are preserved. Unknown filters and incomplete scans fail closed, never silently broadening a deletion selection.
- **Clear:** Uncheck the current selection without deleting anything.
- **Delete selected:** Confirm the total once, then send up to **8 concurrent DELETE requests**. GitHub provides a per-run deletion endpoint, not an atomic bulk-delete request.

Individual deletions succeed or fail independently. Successfully deleted rows disappear immediately. After **all requests have completed successfully**, the page **automatically reloads** so GitHub's counts and empty-state UI are updated. If any deletion fails, the page does **not** reload; failed runs remain selected for retry. The persistent status text is hidden visually but remains accessible to screen readers. Selecting runs across pages does not load off-page rows into the list.

Selection and deletion state are held per repository during the current page session. It is not persisted to disk.

## Background execution

**Concurrency is not durable background execution.** Multiple deletion requests can run simultaneously while the tab remains open, including when it is in the background. Closing or fully navigating away from the page may cancel outstanding requests, and the userscript has no ability to guarantee their completion. Guaranteed unattended cleanup requires a separate server-side GitHub Actions job with appropriate repository permissions.

## Compatibility and safety

The userscript depends on GitHub's rendered Actions list, Primer classes, the page's `fetch-nonce`, and GitHub's internal web deletion endpoint. **All Time** uses GitHub's public REST API, not scraped HTML. The page structure and internal DELETE endpoint are not stable public APIs; a layout or authentication change can still break the UI or deletion.

**All Time currently supports public repositories without a token.** GitHub's unauthenticated API rate limits apply; scanning private repositories would require an explicit authentication mechanism and is not silently attempted. **All on Page** and deletion use your existing GitHub web session.

The implementation deliberately fails closed on unreadable API results, unsupported filters, incomplete scans, and unsupported HTTP deletion responses. It does not collect or save session cookies, ask for a PAT, or change workflow definitions. Deleting a workflow run is permanent and removes its logs and artifacts. Use a disposable run to confirm that deletion still works against the live GitHub UI before deleting large batches.

The prior browser flows were tested in headless Chromium with mocked responses. Version 0.9.4's REST scanner and deletion behavior are covered by regression tests, including successful eight-way concurrency, refresh after completion, cancelled deletion, partial failures, and pagination in `tests/userscript.test.cjs`. Run them using `node --test tests/userscript.test.cjs`. The authenticated live GitHub endpoint has not been tested here.

## License

Distributed under the ISC License. [LICENSE](LICENSE).
