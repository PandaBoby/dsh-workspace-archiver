# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-19

### Added

- A workspace-row context-menu action, **Archive sessions in this workspace**,
  registered through `ctx.contextMenus` with `target: 'workspace'` at order 200.
- Sequential bulk archive over the workspace's non-archived sessions through
  `ctx.uiWorkspace.archiveSession`; already archived sessions are skipped.
- Partial-failure handling: sessions with running work are refused by the Host,
  counted in the notice, and logged to the console without stopping the batch.
- A notice with **Undo** that unarchives exactly the sessions the run archived.
- Duplicate-run guard while a workspace archive is still awaiting the Host.
- English and Chinese menu/notice copy registered through `ctx.locale`.
- A zero-build bundle: hand-written `index.js` and `client.js`, no dependencies,
  no transpiler, no lockfile.
- Plugin Manager metadata, a 36×36 icon, and a single-image detail document.

### Documentation

- Chinese-first README with a complete English translation, language switcher,
  CI/npm/release/license/Node badges, requirements, quick start, architecture
  diagram, troubleshooting, and known limitations.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, and
  `docs/verification.md`.

### Known limitations

- The workspace row itself is not hidden. DSH renders one group per registered
  workspace even when every member is archived, and there is no workspace-level
  hide API in 0.2.2-rc.5.
- Sessions with running work are not stopped. DSH's own archive flow asks the
  user to confirm stopping that work per session.
