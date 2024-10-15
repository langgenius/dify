import React from 'react'
import type { Preview } from '@storybook/react'
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import I18nServer from '../app/components/i18n-server'

import '../app/styles/globals.css'
import '../app/styles/markdown.scss'
import './storybook.css'

export const decorators = [
    withThemeByDataAttribute({
      themes: {
        light: 'light',
        dark: 'dark',
      },
      defaultTheme: 'light',
      attributeName: 'data-theme',
    }),
    Story => {
      return <I18nServer>
        <Story />
      </I18nServer>
    }
  ];

const preview: Preview = {
  parameters: {
        controls: {
            matchers: {
                color: /(background|color)$/i,
                date: /Date$/i,
            },
        },
    },
}

export default preview
