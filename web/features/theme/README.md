# Theme

This feature owns the color theme contract. It is the only Web module that imports `next-themes`; lint rejects that import everywhere else.

- `theme.ts` owns the `ThemePreference` (`light`, `dark`, `system`) and `ResolvedTheme` (`light`, `dark`) types, and the option list (value, icon, `common` label key) that every theme control renders in the same order.
- `provider.tsx` owns the provider configuration: the `data-theme` attribute, `system` as the default preference, and the CSP nonce.
- `hooks.ts` separates the two questions a component can ask. `useThemePreference` returns what the user chose and is for theme controls. `useResolvedTheme` returns the light or dark value in effect and is for icons, editors, charts, and Marketplace links. A Marketplace link never receives `system`.
- `theme-selector.tsx` is the standalone icon menu for pages without the account menu.

Theme copy lives in the `common` namespace (`theme.label`, `theme.light`, `theme.dark`, `theme.system`) because console, share, auth, and Goto Anything surfaces all load it. Surface-specific descriptions stay with their surface.
