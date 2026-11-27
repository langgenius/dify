import { expect, it } from 'vite-plus/test'
import { getEndUserAppHref } from '../app-link'

it('opens a Completion app at its published WebApp route', () => {
  expect(getEndUserAppHref({ mode: 'completion', app_code: 'summarize-text' })).toBe(
    '/completion/summarize-text',
  )
})
