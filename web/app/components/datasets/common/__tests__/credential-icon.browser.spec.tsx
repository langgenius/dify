import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { CredentialIcon } from '../credential-icon'

const validAvatar =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="2"%3E%3Cpath fill="%23000" d="M0 0h2v2H0z"/%3E%3C/svg%3E'
const brokenAvatar = 'data:image/png;base64,not-an-image'

it('keeps the fallback visible until a replacement avatar decodes natively', async () => {
  const screen = await render(<CredentialIcon name="Alice" />)

  await expect.element(screen.getByText('A')).toBeVisible()
  await expect.element(page.getByRole('img')).not.toBeInTheDocument()

  await screen.rerender(<CredentialIcon avatarUrl={brokenAvatar} name="Bob" />)
  await expect.element(screen.getByText('B')).toBeVisible()

  await screen.rerender(<CredentialIcon avatarUrl={validAvatar} name="Bob" />)
  await expect.element(screen.getByText('B')).not.toBeInTheDocument()
  await expect.element(page.getByRole('img')).not.toBeInTheDocument()
})
