import { render } from 'vitest-browser-react'
import { CollaboratorAvatar } from '../collaborator-avatar'

it('uses the URL supplied for the collaborator and updates when their picture changes', async () => {
  const avatarUrl = '/logo/logo.svg'
  const screen = await render(
    <CollaboratorAvatar collaborator={{ id: 'ann', name: 'Ann', avatarUrl }} />,
  )
  await expect
    .poll(() => screen.container.querySelector('img')?.getAttribute('src'))
    .toBe(avatarUrl)

  await screen.rerender(
    <CollaboratorAvatar
      collaborator={{ id: 'ann', name: 'Ann', avatarUrl: '/logo/logo-site.png' }}
    />,
  )
  await expect
    .poll(() => screen.container.querySelector('img')?.getAttribute('src'))
    .toBe('/logo/logo-site.png')
})
