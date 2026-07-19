import type { Member } from '@/models/common'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactsManagementMockProvider } from '../composition'
import { MemberRemovalContactImpactDialog } from '../member-removal-dialog'
import { ContactsMockScenario, createContactsMockScenario } from '../mock/scenarios'

const member: Member = {
  avatar: '',
  avatar_url: '',
  created_at: '1731000000',
  email: 'owner@example.com',
  id: 'member-owner',
  last_active_at: '1731000000',
  last_login_at: '1731000000',
  name: 'Ralph Edwards',
  role: 'admin',
  roles: [],
  status: 'active',
}

function renderDialog(scenarioName: ContactsMockScenario, wait?: () => Promise<void>) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const onOpenChange = vi.fn()
  const onRemoved = vi.fn()
  const scenario = createContactsMockScenario(scenarioName)
  render(
    <QueryClientProvider client={queryClient}>
      <ContactsManagementMockProvider scenario={scenario} wait={wait}>
        <MemberRemovalContactImpactDialog
          member={member}
          open
          onOpenChange={onOpenChange}
          onRemoved={onRemoved}
        />
      </ContactsManagementMockProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, onRemoved }
}

describe('MemberRemovalContactImpactDialog', () => {
  it('defaults EE retention to selected and submits the visible choice', async () => {
    const user = userEvent.setup()
    const { onOpenChange, onRemoved } = renderDialog(ContactsMockScenario.EeMixed)
    const retention = screen.getByRole('checkbox', {
      name: /contacts\.memberRemoval\.keepPlatform/,
    })
    expect(retention).toBeChecked()
    await user.click(retention)
    expect(retention).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'contacts.memberRemoval.remove' }))

    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it.each([ContactsMockScenario.CeMixed, ContactsMockScenario.SaasMixed])(
    'does not offer retention in %s',
    (scenario) => {
      renderDialog(scenario)

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(screen.getByText('contacts.memberRemoval.standardDescription')).toBeInTheDocument()
    },
  )

  it('keeps the dialog and selection after a recoverable failure', async () => {
    const user = userEvent.setup()
    const { onOpenChange, onRemoved } = renderDialog(ContactsMockScenario.RemovalFailure)
    await user.click(screen.getByRole('button', { name: 'contacts.memberRemoval.remove' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('contacts.memberRemoval.failed')
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onRemoved).not.toHaveBeenCalled()
  })

  it('disables duplicate confirmation while the removal is pending', async () => {
    let resolveRemoval: (() => void) | undefined
    const wait = () =>
      new Promise<void>((resolve) => {
        resolveRemoval = resolve
      })
    const user = userEvent.setup()
    const { onRemoved } = renderDialog(ContactsMockScenario.EeMixed, wait)
    await user.click(screen.getByRole('button', { name: 'contacts.memberRemoval.remove' }))

    const pendingButton = screen.getByRole('button', {
      name: 'contacts.memberRemoval.removing',
    })
    expect(pendingButton).toBeDisabled()
    expect(onRemoved).not.toHaveBeenCalled()
    await act(async () => resolveRemoval?.())
    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce())
  })
})
