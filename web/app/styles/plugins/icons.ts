/*
 * Pre-bound icons plugin used by `web/`. Combines Iconify's heroicons and
 * remix icon packs with the project's custom public and vendor sprites.
 * Wired into Tailwind v4 via `@plugin './plugins/icons.ts';` in tailwind-core.css.
 */
import { icons as customPublicIcons } from '@dify/iconify-collections/custom-public'
import { icons as customVenderIcons } from '@dify/iconify-collections/custom-vender'
import { getIconCollections, iconsPlugin } from '@egoist/tailwindcss-icons'

export default iconsPlugin({
  collections: {
    ...getIconCollections(['heroicons', 'ri']),
    'custom-public': customPublicIcons,
    'custom-vender': customVenderIcons,
  },
  extraProperties: {
    width: '1rem',
    height: '1rem',
    display: 'block',
  },
})
