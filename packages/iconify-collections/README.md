# @dify/iconify-collections

Pre-generated Iconify collections for Dify custom SVG icons. The web app imports these collections from this package so Tailwind does not need to scan and build custom SVG icon data from the old `web/app/components/base/icons/src` tree during dev startup.

## Adding Custom SVG Icons

Add new SVG source files under one of these directories:

- `assets/public/...` for multi-color or public brand-like icons.
- `assets/vender/...` for UI vendor icons that should render with `currentColor`.

After adding or changing SVG files, regenerate the packaged collections:

```bash
pnpm --filter @dify/iconify-collections generate
```

Then run the dimension guard:

```bash
pnpm --filter @dify/iconify-collections check:dimensions
```

This protects existing icon groups with layout-sensitive intrinsic sizes, such as the `main-nav-*` icons that must remain `20x20` after collection flattening.

Commit both the SVG source files and the generated package files under `custom-public/` or `custom-vender/`.
Restart the web dev server after regenerating icons. Tailwind loads this plugin collection at startup, so an already-running dev server may not render newly-added `i-custom-*` classes until it restarts.

Use the generated icons through Tailwind icon classes in frontend code. For example:

```text
assets/vender/integrations/mcp.svg
```

becomes:

```tsx
<span aria-hidden className="i-custom-vender-integrations-mcp size-4" />
```

Do not add new generated React icon components or JSON files under `web/app/components/base/icons/src/...` for new custom SVG icons. That path is legacy; new custom icons should flow through this package and be consumed as `i-custom-*` classes.

When reviewing generated `icons.json` diffs, check that unrelated existing icon groups did not lose or change their intrinsic `width` and `height`. If a group is layout-sensitive, add it to `scripts/check-icon-dimensions.ts`.
