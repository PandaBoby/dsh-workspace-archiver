# Security policy

## Supported versions

Security fixes are applied to the latest published minor line. The repository is
currently on the 0.2.x line; older snapshots may not receive fixes.

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

This bundle archives a workspace's sessions and removes the workspace
registration. It does not add a privilege boundary of its own:

- It reads workspace rows, session ids, and the registry-global archive set
  through `ctx.workspaces.list`.
- It calls `ctx.uiWorkspace.archiveSession` and `ctx.workspaces.delete`, which
  reach the Host Workspace Controller through generated Remote endpoints. **The
  Host enforces the current peer's permissions**; the plugin cannot archive or
  delete a workspace the peer is not allowed to operate on.
- It does not read files, credentials, environment variables, or network
  resources, and it does not send data anywhere.
- Removing the registration keeps the directory and every session log. It does
  **not** delete files or session history.
- It never passes `stopActivity: true`. Sessions with running work are refused by
  the Host; if any archive fails, the workspace is left in place and the notice
  reports the blocked count.
- The archive set is global. Unarchiving an old session after the workspace was
  removed puts it under Ungrouped; membership is not restored by any public API.

The risky operation is workspace removal: a single click archives the
workspace's sessions and deletes its registration. The row disappears and
**cannot be restored through a public API**; re-adding the directory creates a
new, empty workspace. Treat a directory/data backup as part of archiving.

Out of scope: a compromised OS account or browser, a malicious DSH build or
another plugin running with the same privileges, DevTools manipulation while the
page is open, and an operator who deliberately archives and then loses access to
their own profile.

## Handling exposed data

The plugin handles no secrets. If a bug report or log contains session titles,
workspace paths, or conversation excerpts, redact them before posting publicly;
use the private advisory channel instead.
