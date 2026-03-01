import type { StorybookConfig } from '@storybook/nextjs-vite'

const config: StorybookConfig = {
  stories: ['../app/components/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    // Not working with Storybook Vite framework
    // '@storybook/addon-onboarding',
    '@storybook/addon-links',
    '@storybook/addon-docs',
    '@chromatic-com/storybook',
  ],
  framework: '@storybook/nextjs-vite',
  staticDirs: ['../public'],
  core: {
    disableWhatsNewNotifications: true,
  },
  docs: {
    defaultName: 'Documentation',
  },
}
export default config
