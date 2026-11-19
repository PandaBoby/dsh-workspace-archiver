# Verification

What this repository checks automatically, what was checked by hand, and what is
still unverified.

## Automated

```sh
npm run check    # Host/Client syntax, exports, JSON, patch row
npm test         # syntax gate + packaging, Host archive/restore, Client behavior
```

`npm test` currently reports **32/32 passing**. It covers:

- bundle manifest, exports, `dsh` declarations, repository metadata, published
  file list;
- the `workspace` context-menu contribution (id, target, order, label rules,
  danger styling, restore submenu);
- Client archive/restore requests, blocked counts, partial restores, state-route
  failure, network failure, and dictionary parity;
- Host archive → hidden record → delete, abort on a blocked session, delete
  failure cleanup, persistence across store reload, restore via
  `create` + `attachSession` + `unarchiveSession` + order anchor, and keeping a
  separately archived session archived;
- authenticated state/action routes and the `/workspace-archiver` command;
- locale metadata, the single-image detail document, the icon, the bilingual
  README links, community documents, and the CI workflow.

## Checked by hand

- `npm pack --dry-run`: 25 files; runtime files, `src/`, `locale/`, `docs/`,
  icon, license, READMEs, community documents, and `test/` ship;
  `dev.patch.yml` does not.
- `icon.svg` and `docs/preview.svg` rendered with `rsvg-convert` at 36×36 and
  640×300 to confirm geometry and readability.
- API names and behavior checked against DSH 0.2.2-rc.5 through the Cordis
  Inspect tools (`Service` catalog, client `Slots`) and the installed package
  sources. In particular, `workspaceRegistry.create` starts with an empty member
  list, `Workspace.attachSession` is Host-only, and
  `connection.fetch.register` is the authenticated route surface the credential
  settings package also uses.

## Not verified

This release was **not installed into a live DSH profile** and was not exercised
in a browser. The menu row, restore submenu, notices, hidden file, and light/dark
appearance therefore remain unverified in the UI. The local DSH profile is
managed by the Desktop application, and the approval-gated install step was not
available in the development session.

## Manual checklist for a live profile

1. Install or link the bundle and enable **Workspace archiver** in **Plugins**.
2. Reload the page, then right-click a workspace row (not a session row).
3. Confirm the danger-styled archive action appears between Rename and Delete,
   with the expected non-archived session count, in both English and Chinese.
4. Run it on a workspace with idle sessions: every session is archived, the row
   disappears, the notice reports the count, and
   `$DSH_HOME/workspace-archiver/hidden.json` contains the record.
5. Restore from another workspace's menu: the row returns, the sessions are
   reattached in their saved order, and they are no longer archived.
6. Hide every workspace, then use `/workspace-archiver` and
   `/workspace-archiver restore <index>` to restore one. Confirm the command
   output lists title, path, session count, and id.
7. Run archive on a workspace with a running session: the notice reports the
   blocked session and the row stays; the running session is not stopped.
8. Move or delete the original directory, then archive another workspace and try
   to restore it: restore should fail with the record kept. Restore a workspace
   whose session cwd is missing: the workspace returns and the result reports the
   session that could not reattach.
9. Open the bundle details: confirm the title, description, and preview image in
   English and Chinese; check the icon in light and dark themes.
