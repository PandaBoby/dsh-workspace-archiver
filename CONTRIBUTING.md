# Contributing

Thanks for improving `dsh-workspace-archiver`. This project is a DSH bundle with a
zero-build Client half: `index.js` and `client.js` are the source and the shipped
artifacts at the same time. Keep changes focused; user-visible behavior needs a test.

## Setup

Requirements: Node.js >= 20 (only for the test suite) and a DSH profile for manual
testing. The package has no runtime or development dependencies, so there is no
install step:

```sh
npm run check
npm test
```

`npm test` runs the syntax gate (`test/support/check-syntax.mjs`) first, then the
packaging and behavior tests.

## Translations

`README.md` is the canonical Simplified Chinese README; `README.en.md` is the
complete English translation. To add another language:

- copy `README.md` to `README.<language>.md` and translate the prose, not code
  identifiers, commands, API names, or limitation wording;
- keep the same section order and update the language bar in every README;
- add the new file to the `files` array in `package.json` if it should ship on npm;
- avoid machine-only translations without review, especially for the limitations
  and security wording.

Open one PR with the new README and the language-bar updates.

## Code style

- ESM only, no build step for the Host or Client half.
- Two-space indentation; keep the style of the surrounding file.
- **`client.js` must not declare top-level bindings.** Combo responses concatenate
  several bundle scripts, so everything except the `window.__ModuleLoader__.load`
  call lives inside `factory`. A top-level `const` can collide with another plugin.
- Use official DSH extension points: `ctx.contextMenus`, `ctx.uiWorkspace`,
  `ctx.workspaces.list`, `ctx.locale`. Do not hook the shipped sidebar's DOM or
  register into a private slot.
- Comments explain *why* (ordering, lifecycle, API ownership), not what the next
  line obviously does.
- Keep user-visible copy in the `en`/`zh` dictionaries; keys must stay aligned.

## Tests

Add or update tests when changing:

- the context-menu target, order, label, or visibility rules;
- the archive loop, duplicate-run guard, partial-failure counts, or undo;
- dictionary keys or language coverage;
- `package.json`, the bundle patch, locale metadata, the icon, or the detail image.

Tests use only Node's built-in `node:test`; do not add a test runner dependency.

## Pull requests

Please include:

- a short description of the user-visible change and its limitations;
- the commands you ran (`npm run check`, `npm test`);
- documentation updates for new menu items, notices, or limitations;
- a `CHANGELOG.md` entry for user-visible changes.

Do not commit `node_modules`, `.env` files, or a packed `*.tgz`. The repository
`.gitignore` covers those.

## Community

Be respectful and constructive; see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Release checklist

- Run `npm run check` and `npm test`.
- Verify `package.json` `repository`, `homepage`, and `bugs` point at the real
  project URLs before publishing.
- Update `CHANGELOG.md`, the version, and the compatibility line in both READMEs.
- Run `npm pack --dry-run` and confirm the runtime files, `docs/`, locale files,
  and icon are included, and `dev.patch.yml` is not.
- Install the packed or linked bundle in a scratch profile and verify the menu,
  notice, undo, and detail page (see `docs/verification.md`).

## Security reports

Do not open a public issue with exploit details, session logs, or personal data.
Follow [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the MIT License.
