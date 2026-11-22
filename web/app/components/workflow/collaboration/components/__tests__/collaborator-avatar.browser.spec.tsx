import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { CollaboratorAvatar } from '../collaborator-avatar'

const signed = (nonce: string) => `/logo/logo.svg?timestamp=1&nonce=${nonce}`

it('keeps the loaded image when only the signature of its URL changes', async () => {
  // Avatars keep one URL per picture in the query cache.
  const screen = await render(
    <CollaboratorAvatar collaborator={{ id: 'ann', name: 'Ann', avatarUrl: signed('first') }} />,
    { wrapper: createConsoleQueryWrapper().wrapper },
  )
  await expect
    .poll(() => screen.container.querySelector('img')?.getAttribute('src'))
    .toBe(signed('first'))

  await screen.rerender(
    <CollaboratorAvatar collaborator={{ id: 'ann', name: 'Ann', avatarUrl: signed('second') }} />,
  )
  expect(screen.container.querySelector('img')?.getAttribute('src')).toBe(signed('first'))

  await screen.rerender(
    <CollaboratorAvatar
      collaborator={{ id: 'ann', name: 'Ann', avatarUrl: '/logo/logo-site.png' }}
    />,
  )
  await expect
    .poll(() => screen.container.querySelector('img')?.getAttribute('src'))
    .toBe('/logo/logo-site.png')
})
