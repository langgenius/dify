# Internationalization

English JSON files under `web/i18n/locales/en-US/` are the source locale. Other locale directories must keep the source flat keys and placeholders. They may also add the plural variants required by their language. i18next uses `keySeparator: false`, so dots are part of a key rather than nested-object separators.

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

After changing English resources, run `pnpm i18n:generate-types` from `web/` and
commit `resources.generated.d.ts`. The script calls
[`i18next-resources-for-ts`]
with `optimize: true`; the official tool preserves string literal values for
i18next's interpolation inference and groups plural variants into base keys.
Use those base keys with `count` instead of selecting `_one` or `_other` yourself.
The project script handles namespace file names, formatting, and freshness checks.
The generated file is type-only;
runtime resource loading still uses JSON. Both `i18n:check` and the Web Style CI
job reject stale generated types (`pnpm i18n:check-types`).

Use a plural base selector with a numeric `count`, for example
`t($ => $['accessControlDialog.members'], { count: members.length })`.
Keep `enableSelector: 'optimize'` for the large translation catalog.
Before migrating a suffixed plural selector to a base key, provide every category
returned by `Intl.PluralRules(locale).resolvedOptions().pluralCategories` in
every supported locale. Missing categories can fall back to English even when
`_one` and `_other` exist. The key checker permits language-specific variants
of source plural families and preserves them during `--auto-remove`; their
placeholders and tags are checked against the English `_other` variant.
The official i18next 26.4 selector types check interpolation parameters when
options are supplied, but still allow the entire options argument to be omitted
in this mode. Generated types do not close that upstream gap, and plural strings
without a `{{count}}` placeholder do not infer a required count. Always supply
the runtime `count` for plural calls. Broad `SelectorParam` annotations also
widen the selected value to `string`; prefer inline selectors when parameter
inference matters. See the [official TypeScript guidance] and [plural rules].

When copy demonstrates template syntax literally, pass that syntax explicitly,
for example `{ input: '{{input}}' }`. For dynamic labels, constrain the key union
to the relevant feature rather than accepting every key in a namespace.

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

## On-demand resources

The App Router client Provider owns one i18next instance per mounted Provider,
using `react-i18next` with Suspense and the same resource backend during SSR and
browser rendering. The root server Provider starts with an empty resource store
and no initial namespaces, including no `common` preload. Components keep declaring their namespaces
through `react-i18next`; a missing namespace loads through `loadI18nResource` during
both streaming SSR and browser rendering. Optional features load their translations
when rendered, without a separate route namespace map or root readiness gate.

Keep the Provider mounted for the application session. Its initial server locale
and resources bootstrap that session; client language preferences and share-app
overrides own subsequent language changes. Passing the original server props again
must not reset those overrides. The namespace options are created per Provider
because i18next mutates its requested namespace list.

Feature-owned Suspense boundaries can isolate translation loading along with the
feature's other loading work. Shell consumers load `common` on demand during SSR;
the initial shell may wait for that dictionary. During SSR, a Provider-local
collector reads react-i18next's reported namespaces and streams newly loaded
resources through `useServerInsertedHTML`, including the active fallback language.
Inline updates use the request CSP nonce and escape script-sensitive text. Each
Provider has a hydration-stable ID so concurrent requests and separate Providers
do not share a resource collection.

The client merges available streamed resources before creating its i18next instance
and subscribes to later updates. This avoids fetching SSR-used dictionaries again
while hydrating interactive controls. Namespaces for features not rendered during
SSR continue to load on demand. Client navigation has no HTML insertion pass and
continues to use the existing backend. The collector sends complete namespaces,
not individual keys.

Language switching follows i18next's requested namespace list, including features
visited earlier in the session. Previously loaded bundles remain cached. There is
no route policy that resets `i18n.options.ns` on navigation.

Server metadata requests still use the request-scoped server instance and load
exactly their requested namespace. Existing server consumers without a namespace
retain their full-catalog behavior.

The build analyzer continues to report route usage and check unused keys. Its
route report is diagnostic and is not a runtime resource manifest or an allowlist.
The application no longer opts into exhaustive route namespace validation.

Tests cover on-demand feature loading, navigation state, language persistence,
English fallback, and concurrent streaming SSR in different locales. Production
Vinext/browser checks are also needed when changing the Provider or loading strategy.

### Provider trial verification

On 2026-09-23, the production Vinext standalone build was checked in fresh
Chromium contexts using local system-features and unauthenticated API fixtures.
English and Simplified Chinese sign-in rendered correctly after hydration without
runtime or hydration errors. The raw HTML contains the shell and a loading spinner,
not the login form: `NormalForm` waits for the client account-profile probe. This
browser check does not establish that the complete login form is server-rendered.
English hydration requested `en-US/login`; Chinese hydration
requested `zh-Hans/login` and `en-US/login`. Switching English to Chinese requested
only `zh-Hans/common` and `zh-Hans/login`. Navigation to sign-up and back preserved
Chinese and requested no additional translation modules. These counts use the
client build manifest, exclude loader modules, and are not backend latency metrics.
Authenticated feature navigation remains unverified.

### Streaming resource verification

The Chromium hydration regression renders the real creation menu on the server,
collects its dictionaries, and hydrates with client backend requests held pending.
Its first click opens the menu without disabling the trigger or retrying the click.
It also verifies that a later resource update reaches the mounted Provider before
its feature renders. Unit coverage checks incremental collection, fallback
languages, Provider isolation, and inline-script escaping.

A production Next.js sign-in check with controlled unauthenticated API fixtures
confirmed English and Chinese `login` resources in the HTML stream, no repeated
login translation chunk requests, and no browser hydration errors. Production
Vinext validation remains pending; its build was stopped to limit local resource
usage. The complete authenticated Agent creation journey must still pass CI.

Empty-store coverage also verifies shell rendering without an enclosing Suspense
boundary, concurrent locale/fallback rendering, and hydration of both `common`
and feature namespaces without duplicate backend requests.

[`i18next-resources-for-ts`]: https://github.com/i18next/i18next-resources-for-ts
[official TypeScript guidance]: https://www.i18next.com/overview/typescript
[plural rules]: https://www.i18next.com/translation-function/plurals
