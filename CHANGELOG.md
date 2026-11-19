# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-19

### Changed

- Reframed the plugin around the workspace row instead of bulk session archiving:
  **Archive and hide this workspace** archives every unarchived session, then
  removes the workspace registration so the row actually leaves the sidebar.
- The action is danger-styled and aborts before removing the workspace when any
  session cannot be archived. A running session or a missing permission leaves the
  workspace in place instead of stranding unarchived sessions under Ungrouped.
- The notice reports archived/blocked counts and explains that the directory and
  session logs are kept.

### Removed

- The undo action. The Host `Workspace.attachSession` is not exposed through the
  Remote, so no public Client API can restore membership after the registration is
  removed; an undo would only recreate an empty workspace.

### Known limitations

- Workspace removal is one-way. Re-adding the directory creates a new empty
  workspace; unarchived old sessions fall under Ungrouped.
- Removing the registration is the shipped **Delete workspace** capability; this
  bundle's difference is archiving the sessions first, in one action.

## [0.1.0] - 2026-11-19

### Added

- A workspace-row context-menu action that archived every unarchived session of a
  workspace, with a notice and an undo action.
- Sequential archive through `ctx.uiWorkspace.archiveSession`, partial-failure
  counts, duplicate-run guard, English/Chinese copy, zero-build bundle, bilingual
  README, plugin detail image.

### Known limitations

- The workspace row itself was not hidden. That release only cleared the session
  list, which is why 0.2.0 changes the feature.
