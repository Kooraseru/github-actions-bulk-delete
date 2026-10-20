<div align="center">
  <h1>GitHub Actions Bulk Delete</h1>
</div>

Adds bulk selection and deletion of GitHub Actions workflow runs through a userscript, without requiring a personal access token.

<a id="overview"></a>
## Overview

GitHub Actions Bulk Delete adds selection checkboxes and a batch deletion control to repository Actions pages.

The userscript uses GitHub's existing browser session to send deletion requests to GitHub's web endpoint. It does not ask for or store personal access tokens. The interface reuses GitHub's Primer styles and controls, with minimal CSS for checkbox positioning.

<a id="installation"></a>
## Installation

Requires a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/).

[Install GitHub Actions Bulk Delete](https://github.com/Kooraseru/github-actions-bulk-delete/raw/refs/heads/main/github-actions-bulk-delete.user.js)

The userscript specifies `@updateURL` and `@downloadURL` pointing to the raw file on the `main` branch. Tampermonkey can check for newer versions automatically according to its update settings. Increment the `@version` field when publishing updates.

<a id="behavior"></a>
## Behavior

The current implementation:

- Detects repository Actions pages.
- Adds a checkbox to each loaded workflow run and an option to select all runs on the current page.
- Preserves selection across dynamic list updates within the repository.
- Displays the number of selected runs and requires one confirmation per batch.
- Sends sequential DELETE requests using the existing GitHub browser session.
- Reports deletion progress and stops on a failed request.
- Refreshes the workflow list after successful requests.
- Reuses GitHub's existing styles for buttons and other controls.

Selection does not include workflow runs on other pages. Deleting a workflow run also removes its associated logs and artifacts. The script does not edit workflow definitions or repository files.

<a id="compatibility"></a>
## Compatibility

The userscript targets GitHub's repository Actions interface.

It depends on GitHub's rendered list structure, Primer styling, and internal session-authenticated deletion endpoint. GitHub can change any of these without notice. The deletion mechanism was reconstructed from browser network requests and has not been independently verified through a successful userscript deletion. Test with a disposable run before bulk deletion.

<a id="license"></a>
## License

GitHub Actions Bulk Delete is distributed under the ISC License. [LICENSE](LICENSE).
