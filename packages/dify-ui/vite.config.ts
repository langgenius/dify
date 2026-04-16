import { defineConfig } from 'vite-plus'

export default defineConfig({
  staged: {
    '*.{ts,css}': 'eslint --fix',
  },
  lint: {
    ignorePatterns: [
      'src/themes/tailwind-theme-var-define.ts',
      'src/themes/light.css',
      'src/themes/dark.css',
    ],
    options: {
      typeAware: true,
      typeCheck: true,
      denyWarnings: true,
    },
  },
  fmt: {
    ignorePatterns: [
      'src/themes/tailwind-theme-var-define.ts',
      'src/themes/light.css',
      'src/themes/dark.css',
    ],
    singleQuote: true,
    semi: false,
  },
})
