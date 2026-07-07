/*
 * `@tailwindcss/typography` configured with Dify's prose color tokens.
 * Injects `theme.typography` for v4 CSS-first via plugin `config` merge.
 */
import typographyPlugin from '@tailwindcss/typography'
import typographyConfig from './typography-config.js'

const created = typographyPlugin()

export default {
  handler: created.handler,
  config: {
    theme: {
      typography: typographyConfig,
    },
  },
}
