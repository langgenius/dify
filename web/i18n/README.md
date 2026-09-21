# Internationalization

English JSON files under `web/i18n/locales/en-US/` are the source locale. Other locale directories must keep the same flat keys and placeholders. i18next uses `keySeparator: false`, so dots are part of a key rather than nested-object separators.

The module keeps runtime code and bundled translation assets together. `#i18n` remains the conditional client/server entrypoint; `locales/` contains translation JSON only. Per-locale loaders preserve the existing dynamic-import boundaries. This layout is a project ownership convention, not an i18next requirement.

## Owners

- `languages.ts` is the source of truth for supported Web locales.
- `locale.ts` owns canonical UI locale tags, the default locale, and input normalization.
- `language.ts` owns documentation, access-template, and date-library locale mappings.
- `metadata.ts` owns plugin/model language mappings and localized metadata selection.
- `index.ts` exports only shared configuration and the canonical UI locale type.
- `client.ts` owns client language changes and cookie persistence.
- `#i18n` selects the client or server translation hooks; use it for `useLocale`.
- `resources.ts` owns the typed namespace registry. File names use kebab case while namespaces use camel case, for example `app-debug.json` and `appDebug`.
- `locale-resources/<locale>.ts` owns lazy loading for one locale.
- `settings.ts` owns shared i18next options.
- `web/scripts/check-i18n.js` owns locale key validation and removal of extra keys.

Do not copy the language registry into documentation. Read the current source files when adding a locale or namespace.

## Add a locale

1. Add the locale metadata to `languages.ts`.
2. Add a matching `web/i18n/locales/<locale>/` directory with every source namespace.
3. Add `locale-resources/<locale>.ts` and the required mappings in `language.ts`.
4. Keep the backend language and timezone registry in `api/constants/languages.py` aligned when the locale is accepted by backend APIs.
5. Run the complete i18n check before submitting the change.

`supportedLocales` is populated from the supported entries in `languages.ts`. `language.ts` exposes the existing `LanguagesSupported` and `I18nText` contracts.

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

## Unused translations

Vite application builds (`vp run build:vinext`) fail when static analysis identifies
potentially unused English keys in the application module graph. CI runs the same build in Web Style. The plugin
collects original module sources before transforms and analyzes each final client,
SSR, and RSC graph with its own source map after all environments finish. A key is
reported only when it is unused in every environment. Files that
are not imported by the application, including standalone tests and stories, do
not count as usage. Type-only dependencies inform analysis but do not count as
usage themselves.

Unresolved dynamic keys protect their namespaces. The report may contain false
positives or miss unused keys; review actual usage before deleting any translations.
Findings list namespace and key; remove confirmed unused keys from all locale files
or restore their application usage. The
plugin never modifies locale files. The previous whole-project prune CLI has been
removed so there is only one definition of unused translations.

Development, Storybook, and test startup do not run this check. Next.js builds do
not load Vite plugins.

## Automated translation

Changes to `web/i18n/locales/en-US/*.json` on `main` trigger the scoped translation workflow. The workflow derives target locales from `languages.ts`, translates only the changed namespaces and keys, verifies them with `i18n:check`, and opens a pull request when translations change.

Use the `Translate i18n Files with Claude Code` workflow dispatch for a manual scoped sync. Full mode requires an explicit file list.

## Initial route resources

`route-namespaces.ts` owns the explicit `routeNamespaceDeclarations` opt-in map
shared by server selection, client navigation and production build validation. `/signin` and its child routes use `common` and
`login`. Other routes retain the complete registry until they are migrated.

The server reads the pathname that `proxy.ts` overwrites on every request. Missing
or unknown paths conservatively use the full registry. Base paths are supported.
Serialized resources include the requested locale and English fallback for the
selected namespaces, keeping translation initialization ready for SSR and hydration.
Sign-in still includes only `common` and `login`.

Client initialization uses only the provided namespaces. The default namespace is
`common` for sign-in, so a bare `useTranslation()` does not request `app`. The
provider keeps the same i18next instance across rerenders and locale changes.
A namespace-set change resets only the translation readiness component; the
provider and business subtree retain their state, including active notifications.
The loader suspends missing translations into the existing router/root boundaries;
the provider adds no application-wide Suspense fallback. The current route's
namespace list also controls language switching without discarding loaded bundles.

Server metadata requests initialize an empty instance and load their requested
namespace. Existing server consumers without a namespace keep the full-catalog
behavior for cross-namespace calls.

### Build validation

Production Vite builds check every opted-in route against its declaration using
the combined client, SSR and RSC module graphs. The check includes page imports,
shared layouts and boundaries, dynamic imports and conservative parallel slots.
An undeclared namespace fails the build and lists the route and source files.
The JSON analysis report is written before validation, so it remains available
when validation fails. Unregistered routes are not checked against a restricted
list and continue to load the full catalog.

Add a subtree to `routeNamespaceDeclarations` after auditing its dependencies;
more specific declarations override ancestor declarations. The check covers
statically recognized translation usage, including namespace constants, imported
arrays and nested static spreads passed to translation hooks or server loaders,
not arbitrary runtime imports or
unknown translation APIs. Consult the analyzer README for its limitations.

### Production validation of the sign-in migration

Measured locally on 2026-09-18 against layer 2 (`b6405a857a`), using production
Vinext standalone builds and fresh Chromium contexts. Both builds used the same
controlled API fixture: `createSystemFeaturesFixture({ is_allow_register: true })`,
completed setup/init, and an unauthenticated account-profile response. These are
frontend transfer diagnostics, not production-backend latency measurements.

| `/signin` metric                              |  Before |   After |
| --------------------------------------------- | ------: | ------: |
| English HTML response body, bytes             | 438,163 |  95,915 |
| Chinese HTML response body, bytes             | 424,123 | 148,172 |
| English RSC response body, bytes              | 380,526 |  59,829 |
| Chinese RSC response body, bytes              | 366,751 | 108,608 |
| English initial translation-module requests   |       0 |       0 |
| Chinese initial translation-module requests   |      36 |       0 |
| English → Chinese translation-module requests |      37 |       2 |

HTML includes embedded RSC and other page data; HTML and standalone RSC sizes
must not be added. RSC was requested separately using `RSC: 1` on `/signin?_rsc`
with an explicit locale cookie. Body sizes are decoded bytes, not compressed
wire transfer sizes. Estimated gzip sizes for the HTML bodies were approximately
106 KB → 23 KB (English) and 112 KB → 38 KB (Chinese).

Translation requests were identified using the production client manifest's
`i18n/locales/` entries, rather than chunk-name guesses. The new language-switch
waterfall loads the locale loader module, then the common and login modules in
parallel. No translation modules are requested on initial English or Chinese
sign-in hydration. Rendered page text matched the baseline and no browser runtime
errors were recorded. Client navigation to `/signup` and back rendered correctly;
unmigrated destinations still load their complete namespace set on entry.

Unit coverage uses real i18next/react-i18next to check initial loading, missing-key
fallback, locale persistence, route transitions and active-route language changes.
The route-analysis report is diagnostic guidance, not an automatic resource manifest.
Datasets and authenticated feature-navigation/network validation remain follow-up
work for issue #42442; this migration does not close that issue.
