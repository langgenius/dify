# Internationalization

English JSON files under `web/i18n/en-US/` are the source locale. Other locale directories must keep the same flat keys and placeholders. i18next uses `keySeparator: false`, so dots are part of a key rather than nested-object separators.

## Owners

- `languages.ts` is the source of truth for supported Web locales.
- `locale.ts` owns canonical UI locale tags, the default locale, and input normalization.
- `language.ts` owns product-specific locale mappings.
- `resources.ts` owns the typed namespace registry. File names use kebab case while namespaces use camel case, for example `app-debug.json` and `appDebug`.
- `locale-resources/<locale>.ts` owns lazy loading for one locale.
- `settings.ts` owns shared i18next options.
- `web/scripts/check-i18n.js` owns locale key validation and removal of extra keys.

Do not copy the language registry into documentation. Read the current source files when adding a locale or namespace.

## Add a locale

1. Add the locale metadata to `languages.ts`.
2. Add a matching `web/i18n/<locale>/` directory with every source namespace.
3. Add `locale-resources/<locale>.ts` and the required mappings in `language.ts`.
4. Keep the backend language and timezone registry in `api/constants/languages.py` aligned when the locale is accepted by backend APIs.
5. Run the complete i18n check before submitting the change.

`supportedLocales` is populated from the supported entries in `languages.ts`. `language.ts` exposes the existing `LanguagesSupported` and `I18nText` contracts.

## Initial client namespaces

The root layout serializes only shell and route-matched namespaces into the client i18n instance. Additional namespaces load on demand through the existing locale resource backend when a route changes or a component requests them. Route rules live in `initial-namespaces.ts`.

## Locale selection

A nonempty locale cookie takes priority over `Accept-Language`. An unusable cookie falls back to English without consulting the header. Header negotiation preserves valid preferences and their quality order while ignoring malformed tags and wildcards.

`locale.ts` canonicalizes language tags and accepts the existing `en_US`, `zh_Hans`, and `ja_JP` spellings at input boundaries. Client language changes, saved preferences, and resource paths use supported UI tags or the English default. Share-app language overrides do not write the console locale cookie. Plugin and model metadata spellings remain separate product contracts.

## Add or change copy

Add or change the English key first, then update every supported locale. Preserve interpolation variables and markup placeholders exactly.

Run from `web/`:

```sh
pnpm i18n:check
pnpm i18n:check --file app billing --lang zh-Hans ja-JP
```

Arguments after `--file` and `--lang` are space-separated. Use `--auto-remove` only when intentionally deleting extra locale keys.

## Automated translation

Changes to `web/i18n/en-US/*.json` on `main` trigger the scoped translation workflow. The workflow derives target locales from `languages.ts`, translates only the changed namespaces and keys, verifies them with `i18n:check`, and opens a pull request when translations change.

Use the `Translate i18n Files with Claude Code` workflow dispatch for a manual scoped sync. Full mode requires an explicit file list.
