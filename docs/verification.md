# Verification

What this repository checks automatically, what was checked by hand, and what is
still unverified.

## Automated

```sh
npm run check    # parse client.js as a classic script, import index.js, parse JSON
npm test         # syntax gate + packaging and behavior tests
```

`npm test` currently reports **22/22 passing**. It covers:

- bundle manifest, exports, `dsh` declarations, repository metadata, published
  file list;
- the `workspace` context-menu contribution (id, target, order, label rules,
  danger styling);
- archive-then-delete ordering, abort when any session cannot be archived,
  registration removal, delete-failure reporting, and the duplicate-run guard;
- dictionary key parity between English and Chinese;
- locale metadata, the single-image detail document, the icon, the bilingual
  README links, community documents, and the CI workflow.

## Checked by hand

- `npm pack --dry-run`: 20 files; runtime files, `locale/`, `docs/`, icon,
  license, READMEs, community documents, and `test/` ship; `dev.patch.yml` does
  not.
- `icon.svg` and `docs/preview.svg` rendered with `rsvg-convert` at 36×36 and
  640×300 to confirm geometry and readability.
- API names and behavior checked against DSH 0.2.2-rc.5 through the Cordis
  Inspect tools (`Service` catalog, client `Slots`) and the installed package
  sources. In particular, `workspaces.delete` removes only the registration,
  `workspaces.create` starts with an empty member list, and the Host
  `Workspace.attachSession` is not exposed through the Remote, so there is no
  public way to restore membership.

## Not verified

This release was **not installed into a live DSH profile** and was not exercised
in a browser. The menu row, notice, row removal, and light/dark appearance
therefore remain unverified in the UI. The local DSH profile is managed by the
Desktop application, and the approval-gated install step was not available in the
development session.

## Manual checklist for a live profile

1. Install or link the bundle and enable **Workspace archiver** in **Plugins**.
2. Reload the page, then right-click a workspace row (not a session row).
3. Confirm the danger-styled action appears between Rename and Delete, with the
   expected non-archived session count, in both English and Chinese.
4. Run it on a workspace with idle sessions: every session is archived, the row
   disappears, and the notice reports the count.
5. Run it on a workspace with a running session: the notice reports the blocked
   session and the row stays; the running session is not stopped.
6. Re-add the directory from the workspace picker: it appears as a new, empty
   workspace. Unarchive one old session and confirm it lands under Ungrouped, not
   in the new workspace.
7. Open the bundle details: confirm the title, description, and preview image in
   English and Chinese; check the icon in light and dark themes.
8. Confirm that there is no undo for the workspace registration. That is a known
   limitation, not a regression.
