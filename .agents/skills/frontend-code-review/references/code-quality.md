# Code Quality Rules

## Scope Control

Flag changes that expand beyond the requested feature or review scope:

- Repo-wide cleanup mixed into a targeted fix.
- Compatibility exports, aliases, shims, or wrapper layers added without an explicit migration requirement.
- Shared abstractions created before there is stable cross-feature reuse.
- Business components moved into generic shared locations without a clear ownership boundary.

## TypeScript

Flag:

- `any` or broad `Record<string, any>` where generated/API types or local domain types exist.
- Re-declared API shapes instead of importing generated or returned types.
- Weak route/query param typing that leaks `string | string[] | undefined` deep into components.
- Runtime wrappers added only to satisfy TypeScript when a narrower type boundary would preserve the existing runtime shape.

Prefer:

- Explicit domain names that match the API contract.
- Type narrowing at route/API boundaries.
- Small conversion helpers colocated with the component that needs them.

## Styling

Flag:

- New CSS modules or ad hoc CSS when Tailwind utilities and Dify tokens cover the need.
- Component-level plain `.css` files or component CSS imported through `globals.css`; use scoped `*.module.css` only when Tailwind and component variants cannot express the style.
- Generic color utilities where Dify semantic tokens exist.
- Hardcoded magic class values for colors, spacing, radius, shadow, z-index, or typography when Dify tokens, component variants, or documented radius mappings exist.
- `!` important modifiers or important CSS overrides without a narrow, documented reason.
- Manual string concatenation, template strings, array `.join(' ')`, or custom ternaries for conditional or multi-line classes.
- JS conditional class branches for primitive visual states already exposed by Dify UI/Base UI `data-*` selectors.
- Incoming `className` placed before default classes in `cn(...)`, preventing call-site overrides.
- Arbitrary z-index or one-off layering fixes on overlays.

Use:

- `cn(...)` from the local package or utility already used by the file.
- Dify semantic tokens and Tailwind v4 utilities.
- Existing component variants before one-off class forks.
- Primitive selectors such as `data-disabled:*`, `data-checked:*`, `data-highlighted:*`, `group-data-*`, `peer-data-*`, and `has-[:focus-visible]` before adding React state or boolean props solely for styling.
- Component-level variants, semantic tokens, and normal cascade/order before `!` overrides. Use `!` only for a contained compatibility override that cannot be expressed through the component API or local selector structure.

## Imports

Flag:

- Barrel imports from `@langgenius/dify-ui`; consumers must use subpath exports.
- New overlay imports from legacy `@/app/components/base/modal`, `dialog`, or `drawer`.
- Cross-feature imports that bypass explicit top-level public files.
- Direct imports from generated/internal implementation files when a feature contract already exposes the intended surface.

## Copy And i18n

Flag:

- User-facing hardcoded strings in `web/`.
- Added or renamed i18n keys that are not present in every supported locale file for the touched namespace.
- Translation namespace drift, especially using unrelated module namespaces for local feature copy.
- Generic button labels like `Continue` where the action is specific.
- Error messages that state only the failure and not the next step.

Use feature-local translation keys by default. Alias only when crossing namespaces. `pnpm i18n:check --file <name>` should pass for any touched translation namespace.
