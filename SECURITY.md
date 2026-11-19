# Security policy

## Supported versions

Security fixes are applied to the latest published minor line. The repository is
currently on the 0.3.x line; older snapshots may not receive fixes.

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

This bundle archives a workspace's sessions and removes its registration, and
can restore both from a Host-held record. It does not add a privilege boundary
of its own:

- The browser calls authenticated Host routes registered through
  `ctx.connection.fetch.register`. Connection owns Host/Origin checks and browser
  authentication; the plugin adds no separate token layer. The routes are
  intended for the trusted owner Web UI, like the shipped settings routes.
- The Host calls `workspaceRegistry.archiveSession`, `unarchiveSession`,
  `create`, `delete`, `insertBefore`, and `Workspace.attachSession`. These are
  the same Host services the registry exposes; the plugin does not modify the
  registry's storage directly.
- It does not read files, credentials, environment variables, or network
  resources, and it does not send data anywhere. `Workspace.attachSession` reads
  a session header's cwd and validates that the directory still resolves; that is
  the only filesystem check.
- Removing the registration keeps the directory and every session log. It does
  **not** delete files or session history.
- It never passes `stopActivity: true`. Sessions with running work are refused by
  the Host; if any archive fails, the workspace and hidden record are left
  untouched.
- The hidden record file (`$DSH_HOME/workspace-archiver/hidden.json`) contains
  workspace paths, titles, order anchors, and session ids — **no credentials or
  conversation content**. It is created with mode `0600` in a `0700` directory.
  Deleting it removes the plugin's restore path, not the directory or logs.

The risky operations are workspace removal and restore: a single archive click
archives the sessions and deletes the registration; restore recreates the
workspace and reattaches sessions. Both are limited to the authenticated Host
route/command surface and are not model-visible.

Out of scope: a compromised OS account or browser, a malicious DSH build or
another plugin running with the same privileges, DevTools manipulation while the
page is open, a lost/tampered hidden-record file, and an operator who deliberately
archives and then loses access to their own profile.

## Handling exposed data

The plugin handles no secrets. The hidden file can contain workspace paths,
titles, and session ids; if it is exposed, those metadata facts are exposed, not
session contents. If a bug report or log contains session titles, workspace
paths, or conversation excerpts, redact them before posting publicly; use the
private advisory channel instead.
