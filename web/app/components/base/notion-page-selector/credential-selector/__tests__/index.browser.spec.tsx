import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import CredentialSelector from '../index'

function WorkspaceOwner() {
  const [credential, setCredential] = useState('1')
  return (
    <>
      <CredentialSelector
        value={credential}
        onSelect={setCredential}
        items={[
          { credentialId: '1', credentialName: 'Workspace 1', workspaceName: 'Notion Workspace 1' },
          { credentialId: '2', credentialName: 'Credential Name 2' },
        ]}
      />
      <output aria-label="Selected credential">{credential}</output>
    </>
  )
}

it('applies a keyboard workspace selection, including a credential-name fallback, and restores focus', async () => {
  await page.viewport(1000, 800)
  const screen = await render(<WorkspaceOwner />)
  const trigger = screen.getByRole('combobox', { name: 'Notion Workspace 1' })
  await userEvent.tab()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  await expect
    .element(screen.getByRole('option', { name: 'Notion Workspace 1' }))
    .toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(screen.getByRole('option', { name: 'Credential Name 2' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument()
  const selected = screen.getByRole('combobox', { name: 'Credential Name 2' })
  await expect.element(selected).toHaveFocus()
  await expect
    .element(screen.getByRole('status', { name: 'Selected credential' }))
    .toHaveTextContent('2')
  await selected.click()
  await expect
    .element(screen.getByRole('option', { name: 'Credential Name 2' }))
    .toHaveAttribute('aria-selected', 'true')
})
