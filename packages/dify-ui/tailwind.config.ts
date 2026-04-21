import type { Config } from 'tailwindcss'
import { getIconCollections, iconsPlugin } from '@egoist/tailwindcss-icons'
import difyUIPreset from './src/tailwind-preset'

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './.storybook/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  presets: [difyUIPreset],
  plugins: [
    iconsPlugin({
      collections: getIconCollections(['ri']),
      extraProperties: {
        width: '1rem',
        height: '1rem',
        display: 'block',
      },
    }),
  ],
}

export default config
