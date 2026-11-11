# Theme

This feature owns the color theme contract and is the only Web module that imports `next-themes`.

- `theme.ts`: the `ThemePreference` and `ResolvedTheme` types and the shared option list.
- `provider.tsx`: the provider configuration.
- `hooks.ts`: `useThemePreference` returns the user's choice and is for theme controls. `useResolvedTheme` returns the light or dark value in effect and is only for values that must leave CSS.
- `theme-selector.tsx`: a standalone theme menu.

Styling follows the [Dify UI theme guide]. `useResolvedTheme` returns `light` on the server, so styling must not branch on it.

Theme copy lives in the `common` namespace.

[Dify UI theme guide]: ../../../packages/dify-ui/docs/styling.md#theme
