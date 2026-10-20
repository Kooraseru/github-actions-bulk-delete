 <div align="center">
  <h1>GitHub Actions Bulk Delete</h1>
</div>

Adds bulk selection and deletion of GitHub Actions workflow runs through a userscript, without requiring a personal access token or modifying the repository.

<a id="overview"></a>
## Overview

GitHub Actions Bulk Delete allows multiple workflow runs to be selected and deleted directly from a repository's Actions page.

The userscript uses GitHub's existing authenticated browser session to submit deletion requests, avoiding the need to manually delete individual workflow runs or provide a personal access token.

The interface reuses GitHub's Primer components and existing styles to remain consistent with the native interface, including light mode and dark mode.

<a id="installation"></a>
## Installation

Requires a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/).

[Install GitHub Actions Bulk Delete](https://github.com/Kooraseru/github-actions-bulk-delete/raw/refs/heads/main/github-actions-bulk-delete.user.js)

Updates are distributed through the same userscript URL.

<a id="behavior"></a>
## Behavior

The current implementation:

- Detects GitHub repository Actions pages automatically.
- Adds selection checkboxes to individual workflow runs.
- Provides an option to select all workflow runs on the current page.
- Preserves selected runs across dynamic interface updates.
- Displays the number of selected workflow runs.
- Adds a bulk deletion control using GitHub's existing interface styles.
- Requires a single confirmation before deleting the selected runs.
- Uses GitHub's authenticated browser session without requiring a personal access token.
- Sends deletion requests directly to GitHub's existing workflow run endpoint.
- Processes deletion requests sequentially with a short delay.
- Stops processing when a deletion request fails.
- Displays deletion progress and errors.
- Refreshes the workflow list after successful deletions.

The userscript does not modify workflow definitions, repository files, or GitHub Actions configuration. Deletion is limited to selected workflow run records and their associated data.

<a id="compatibility"></a>
## Compatibility

The userscript is intended for GitHub's web interface, specifically repository Actions pages.

Compatibility depends on GitHub's current workflow list structure, Primer styling, and internal authenticated deletion endpoint. Changes to GitHub's frontend or request validation may require updates.

Bulk selection currently applies only to workflow runs loaded on the current page. It does not automatically select historical runs across multiple pages.

The session-authenticated deletion mechanism is based on GitHub's observed internal requests and has not yet been independently verified through the userscript.

<a id="license"></a>
## License

GitHub Actions Bulk Delete is distributed under the ISC License. [LICENSE](LICENSE).
