import type { Config } from 'tailwindcss'
import difyUiTailwindPreset from '@langgenius/dify-ui/tailwind-preset'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './context/**/*.{js,ts,jsx,tsx}',
    './node_modules/streamdown/dist/*.js',
    './node_modules/@streamdown/math/dist/*.js',
    '!./**/*.{spec,test}.{js,ts,jsx,tsx}',
  ],
  ...difyUiTailwindPreset,
}

export default config
