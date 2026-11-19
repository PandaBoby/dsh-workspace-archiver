# Security policy

## Supported versions

Security fixes are applied to the latest published minor line. The repository is
currently on the 0.1.x line; older snapshots may not receive fixes.

## Reporting a vulnerability

Please use the private **Security → Advisories** channel at
<https://github.com/PandaBoby/dsh-workspace-archiver/security/advisories/new>.
Do not open a public issue containing exploit steps, session logs, workspace
paths, or other private data. If that channel is unavailable, contact
`@PandaBoby` and ask for a private channel before sending details.

Include the affected version/commit, a minimal reproduction, and the impact. We
will acknowledge the report, investigate, and coordinate a fix and disclosure.
No response-time or bounty guarantee is implied.

## Scope and boundaries

This bundle archives and unarchives sessions that already exist in the user's
DSH profile. It does not add a privilege boundary of its own:

- It reads workspace rows, session ids, and the registry-global archive set
  through `ctx.workspaces.list`.
- It calls `ctx.uiWorkspace.archiveSession` / `unarchiveSession`, which reach the
  Host Workspace Controller through the generated Remote endpoint. **The Host
  enforces the current peer's permissions**; the plugin cannot archive a session
  the peer is not allowed to archive.
- It does not read files, credentials, environment variables, or network
  resources, and it does not send data anywhere.
- Archiving removes sessions from the default sidebar view and retains their
  logs and workspace accounting. It does not delete files or session history.
- It never passes `stopActivity: true`. Sessions with running work are refused by
  the Host and counted in the notice instead of being stopped.

The one risky operation is bulk archive: a single click can clear a workspace's
session list. It is reversible through the notice's **Undo** or the archived
view, but the notice is transient. Treat a report about an unintended archive as
a usability bug unless it also demonstrates a permission bypass.

Out of scope: a compromised OS account or browser, a malicious DSH build or
another plugin running with the same privileges, DevTools manipulation while the
page is open, and an operator who deliberately archives and then loses access to
their own profile.

## Handling exposed data

The plugin handles no secrets. If a bug report or log contains session titles,
workspace paths, or conversation excerpts, redact them before posting publicly;
use the private advisory channel instead.
