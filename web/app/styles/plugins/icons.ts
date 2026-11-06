/*
 * Pre-bound icons plugin used by `web/`. Combines Iconify's heroicons and
 * remix icon packs with the project's custom public and vendor sprites.
 * Wired into Tailwind v4 via `@plugin './plugins/icons.ts';` in tailwind-core.css.
 */
import { icons as customPublicIcons } from '@dify/iconify-collections/custom-public'
import { icons as customVenderIcons } from '@dify/iconify-collections/custom-vender'
import { iconsPlugin } from '@egoist/tailwindcss-icons'
import { icons as heroicons } from '@iconify-json/heroicons'
import { icons as logos } from '@iconify-json/logos'
import { icons as remixIcons } from '@iconify-json/ri'

export default iconsPlugin({
  collections: {
    heroicons,
    logos,
    ri: remixIcons,
    'custom-public': customPublicIcons,
    'custom-vender': customVenderIcons,
  },
  extraProperties: {
    width: '1rem',
    height: '1rem',
    display: 'block',
  },
})
