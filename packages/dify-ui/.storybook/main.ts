import type { StorybookConfig } from '@storybook/react-vite'
import tailwindcss from '@tailwindcss/vite'
import { mergeConfig } from 'vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-links',
    '@storybook/addon-docs',
    '@storybook/addon-themes',
    '@chromatic-com/storybook',
  ],
  framework: '@storybook/react-vite',
  core: {
    disableWhatsNewNotifications: true,
  },
  docs: {
    defaultName: 'Documentation',
  },
  async viteFinal(config) {
    return mergeConfig(config, {
      plugins: [tailwindcss()],
    })
  },
}

export default config
