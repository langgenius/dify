// import type { Config } from 'tailwindcss'
import commonConfig from './tailwind-common-config'
const config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './context/**/*.{js,ts,jsx,tsx}',
  ],
  ...commonConfig,
}

export default config
