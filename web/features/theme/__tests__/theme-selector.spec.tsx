import { within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { ThemeSelector } from '../theme-selector'

// The server-rendered HTML contract needs no browser; interactive selection lives in Browser Mode.
it('includes the theme trigger in server HTML before hydration', () => {
  const markup = renderToString(<ThemeSelector />)
  const html = new DOMParser().parseFromString(markup, 'text/html')
  expect(within(html.body).getByRole('button', { name: 'common.theme.label' })).toHaveAttribute(
    'type',
    'button',
  )
})
