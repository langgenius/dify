import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import ApiKeyDialog from '@/app/components/share/connections/api-key-dialog'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { useDemoCredentialSchemas } from '../use-demo-credential-schemas'

describe('Connections demo credential validation', () => {
  it('keeps the temporary sk prefix rule in the demo-provided schema', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    function Demo() {
      const credentialSchemas = useDemoCredentialSchemas()
      return (
        <ApiKeyDialog
          mode="add"
          open
          credentialSchemas={credentialSchemas}
          onSave={onSave}
          onOpenChange={vi.fn()}
        />
      )
    }
    render(<Demo />, {
      wrapper: createQueryClientWrapper(
        new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
      ),
    })
    const dialog = screen.getByRole('dialog', { name: 'share.connections.setup.addApiKey' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'Demo key',
    )
    const input = within(dialog).getByLabelText(/share\.connections\.setup\.apiKey/)
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    await user.type(input, 'invalid-demo-key')
    expect(save).toBeDisabled()
    expect(input).toHaveAccessibleDescription('share.connections.apiKeys.validationError')
    await user.clear(input)
    await user.type(input, 'sk-demo-key')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      name: 'Demo key',
      credentials: { api_key: 'sk-demo-key' },
    })
  })
})
