import type { Preview } from '@storybook/react'
import { withThemeByDataAttribute } from '@storybook/addon-themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import I18N from '../app/components/i18n'
import { ToastProvider } from '../app/components/base/toast'

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
        <I18N locale="en-US">
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
