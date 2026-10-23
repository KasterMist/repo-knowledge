# Source and release procedure

## M0 source publication

1. Review the exact repository file list, license, README status and locked toolchain.
2. Run `npm ci` and `npm run check` in the independent project.
3. Push to the public `KasterMist/repo-knowledge` repository; do not upload the surrounding research workspace.
4. Inspect both Windows/Linux CI jobs, configure main-branch required checks and verify with a test PR.
5. Create milestone/Issue links and configure repository governance. Record unavailable settings explicitly.

The manually dispatched `Repository setup` workflow configures the labels and M0–M5 milestones in `.github/repository-setup.json` using a short-lived workflow token. It does not change main-branch protection, install a scheduler or call models. Run it after the source is on main, then verify repository settings separately.

No product tag, VSIX or Marketplace publication is part of M0. Do not add a release workflow that pretends an unimplemented package command is usable.

## M1 and later releases

Implement real VSIX packaging, inspect bundle contents and independently start bundled MCP. Verify the actual package on Windows and Linux and record official Codex IDE acceptance. Create a tag on a checked commit, build once, generate SHA256, upload a draft prerelease, inspect assets and then publish. Download and verify the public artifact again.

Keep product version, tag mapping, changelog and knowledge-format versions consistent. Do not replace an already published artifact or move a public tag; issue a new version for corrections. Marketplace Publisher and authentication are separate tasks.

## First alpha: concrete execution

Release metadata is committed in .github/release.json: VSIX/product version 0.1.0 maps to GitHub tag v0.1.0-alpha.1. VS Code extension versions use a numeric triplet; the alpha designation is in the GitHub prerelease, not a Marketplace listing. All workspaces and internal dependencies share the product version. The schema remains version 1.

The [release notes](../releases/v0.1.0-alpha.1.md) describe installation, limits, evidence, upgrade and rollback. Preparing these files does not publish a Release.

1. Merge the release PR through all five required CI checks. Wait for main's push CI on that exact merged commit to pass as well.
2. Open [Publish GitHub alpha](https://github.com/KasterMist/repo-knowledge/actions/workflows/release.yml). Select Run workflow → branch main → Run workflow. It has no inputs and publishes only the reviewed release metadata. This is an explicit publishing operation, not a schedule or a reaction to ordinary code changes.
3. The workflow requires protected main HEAD and successful exact-source CI, rejects an existing release/tag, builds and checks once, and records source/digest in release-info.json.
4. Windows and Linux install the identical artifact and run packaged-MCP/editor recovery checks without rebuilding it. Only after both pass may the publish job use a short-lived contents-write workflow token. Other jobs stay read-only; no PAT, administrator install, stored secret or Marketplace credentials are required.
5. The publish job creates a draft prerelease on the exact source commit, uploads the VSIX, SHA256SUMS and release-info.json, downloads each draft asset and compares bytes, then publishes. It refuses tag/asset replacement. A failed upload/check leaves a draft for inspection; do not blindly delete, overwrite or rerun against existing assets. Review the failure before choosing recovery or a new product version.
6. Separate Windows/Linux jobs anonymously download the public assets, verify GitHub digests plus recorded SHA/source/version, run the extracted-server check and install that public VSIX in real VS Code. Inspect all six jobs, not only publication success. Public-check failure leaves the published release intact for investigation; do not replace its assets in place.
7. Record the public URL, asset checksum and final workflow run in project status/M1 acceptance and Issue #3. Close T10/M1 only after those public installation jobs pass. Linux editor CI does not establish Linux desktop Codex support.

The current GitHub connector can manage source/PRs but exposes no release-asset upload or workflow-dispatch operation. A maintainer can start the prepared workflow using the page above; this capability gap is separate from repository authorization. No token should be sent in chat.

### Interrupted first-run recovery

Run 39913035042 passed build and both identical-payload installation jobs, created an empty draft, then the first asset upload failed with HTTP 415. No assets or public tag were created. Binary POST uploads must request JSON responses; only binary GET downloads use the octet-stream Accept header. This is a publishing-client defect, not a repository authorization failure.

The reviewed recovery entry in .github/release.json permits only that exact empty, unpublished draft with its recorded previous source. Embedded and separately queried asset lists must both be empty; public tags, published/nonempty drafts and source mismatches are rejected. See [ADR 0004](../architecture/adr/0004-empty-release-draft-recovery.md). Do not delete the draft, replace assets or re-run the old failed job. After the corrected source and main CI pass, explicitly run Publish GitHub alpha on main again. The old job keeps its original buggy source; a fresh dispatch is required to use the fix. T10 remains open until real publication and public installation verification pass.

## References

- [GitHub repository creation](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)
- [GitHub releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [VS Code packaging and publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
