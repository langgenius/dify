/*
 * Pre-bound icons plugin used by `web/`. Combines Iconify's heroicons and
 * remix icon packs with the project's custom public and vendor sprites.
 * Wired into Tailwind v4 via `@plugin './plugins/icons.ts';` in tailwind-core.css.
 * The CommonJS entry gives getIconCollections a filesystem path when linting
 * runs from a temporary working directory.
 */
import { createRequire } from 'node:module'
import { icons as customPublicIcons } from '@dify/iconify-collections/custom-public'
import { icons as customVenderIcons } from '@dify/iconify-collections/custom-vender'

const { getIconCollections, iconsPlugin } = createRequire(import.meta.url)(
  '@egoist/tailwindcss-icons',
) as typeof import('@egoist/tailwindcss-icons')

export default iconsPlugin({
  collections: {
    ...getIconCollections(['heroicons', 'logos', 'ri']),
    'custom-public': customPublicIcons,
    'custom-vender': customVenderIcons,
  },
  extraProperties: {
    width: '1rem',
    height: '1rem',
    display: 'block',
  },
})
