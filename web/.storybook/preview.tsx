import type { Preview } from '@storybook/react'
import type { Resource } from 'i18next'
import { withThemeByDataAttribute } from '@storybook/addon-themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../app/components/base/toast'
import { I18nClientProvider as I18N } from '../app/components/provider/i18n'
import commonEnUS from '../i18n/en-US/common.json'

import '../app/styles/globals.css'
import '../app/styles/markdown.scss'
import './storybook.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
})

const storyResources: Resource = {
  'en-US': {
    // Preload the most common namespace to avoid missing keys during initial render;
    // other namespaces will be loaded on demand via resourcesToBackend.
    common: commonEnUS as unknown as Record<string, unknown>,
  },
}

export const decorators = [
  withThemeByDataAttribute({
    themes: {
      light: 'light',
      dark: 'dark',
    },
    defaultTheme: 'light',
    attributeName: 'data-theme',
  }),
  (Story) => {
    return (
      <QueryClientProvider client={queryClient}>
        <I18N locale="en-US" resource={storyResources}>
          <ToastProvider>
            <Story />
          </ToastProvider>
        </I18N>
      </QueryClientProvider>
    )
  },
]

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      toc: true,
    },
  },
  tags: ['autodocs'],
}

export default preview
