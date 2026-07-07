import { defineConfig } from 'vite-plus'

export default defineConfig({
  staged: {
    '*': 'eslint --fix --pass-on-unpruned-suppressions',
  },
  fmt: {
    singleQuote: true,
    semi: false,
  },
})
