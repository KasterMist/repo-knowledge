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

## References

- [GitHub repository creation](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)
- [GitHub releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [VS Code packaging and publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
