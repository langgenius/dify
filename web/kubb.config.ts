import { defineConfig } from '@kubb/core'
import { pluginOas } from '@kubb/plugin-oas'
import { pluginOrpc } from '@kubb/plugin-orpc'
import { pluginZod } from '@kubb/plugin-zod'

export default defineConfig({
  root: '.',
  input: {
    path: './open-api/api.json',
  },
  output: {
    path: './gen',
    extension: {
      '.ts': '',
    },
    format: false,
    lint: 'eslint',
    clean: true,
    barrelType: false,
  },
  plugins: [
    pluginOas({ validate: false }),
    pluginZod(),
    pluginOrpc(),
  ],
})
