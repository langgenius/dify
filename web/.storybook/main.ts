import type { StorybookConfig } from '@storybook/nextjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const storybookDir = path.dirname(fileURLToPath(import.meta.url))

const config: StorybookConfig = {
  stories: ['../app/components/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-onboarding',
    '@storybook/addon-links',
    '@storybook/addon-docs',
    '@chromatic-com/storybook',
  ],
  framework: {
    name: '@storybook/nextjs',
    options: {
      builder: {
        useSWC: true,
        lazyCompilation: false,
      },
      nextConfigPath: undefined,
    },
  },
  staticDirs: ['../public'],
  core: {
    disableWhatsNewNotifications: true,
  },
  docs: {
    defaultName: 'Documentation',
  },
  webpackFinal: async (config) => {
    // Add alias to mock problematic modules with circular dependencies
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...config.resolve.alias,
      // Mock the plugin index files to avoid circular dependencies
      [path.resolve(storybookDir, '../app/components/base/prompt-editor/plugins/context-block/index.tsx')]: path.resolve(storybookDir, '__mocks__/context-block.tsx'),
      [path.resolve(storybookDir, '../app/components/base/prompt-editor/plugins/history-block/index.tsx')]: path.resolve(storybookDir, '__mocks__/history-block.tsx'),
      [path.resolve(storybookDir, '../app/components/base/prompt-editor/plugins/query-block/index.tsx')]: path.resolve(storybookDir, '__mocks__/query-block.tsx'),
    }
    return config
  },
}
export default config
