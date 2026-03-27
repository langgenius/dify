import { defineConfig } from 'vite-plus'

export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
      denyWarnings: true,
    },
  },
  fmt: {
    singleQuote: true,
    semi: false,
  },
})
