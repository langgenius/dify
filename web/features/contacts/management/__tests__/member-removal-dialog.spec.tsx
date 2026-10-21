import type { ContactsFeatureContextValue } from '../types'
import type { Member } from '@/models/common'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactsManagementProvider } from '../composition'
import { MemberRemovalContactImpactDialog } from '../member-removal-dialog'
import { createContactsMockRepository } from '../mock/repository'
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

function renderDialog(
  scenarioName: ContactsMockScenario,
  wait?: () => Promise<void>,
  imBindingCentrallyManaged?: boolean,
  capabilityState: Partial<
    Pick<
      ContactsFeatureContextValue,
      'imBindingCentrallyManaged' | 'imBindingCapabilityError' | 'retryIMBindingCapability'
    >
  > = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const onOpenChange = vi.fn()
  const onRemoved = vi.fn()
  const baseScenario = createContactsMockScenario(scenarioName)
  const scenario = {
    ...baseScenario,
    imBindingCentrallyManaged: imBindingCentrallyManaged ?? baseScenario.imBindingCentrallyManaged,
  }
  const repository = createContactsMockRepository({ scenario, wait })
  const removeMember = vi.spyOn(repository, 'removeMember')
  render(
    <QueryClientProvider client={queryClient}>
      <ContactsManagementProvider
        context={{
          deployment: scenario.deployment,
          imBindingCentrallyManaged: scenario.imBindingCentrallyManaged,
          permissions: scenario.permissions,
          workspaceId: scenario.workspaceId,
          ...capabilityState,
        }}
        repository={repository}
      >
        <MemberRemovalContactImpactDialog
          member={member}
          open
          onOpenChange={onOpenChange}
          onRemoved={onRemoved}
        />
      </ContactsManagementProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, onRemoved, removeMember }
}

describe('MemberRemovalContactImpactDialog', () => {
  it('does not allow removal before the binding capability is known', async () => {
    const user = userEvent.setup()
    const { removeMember, onRemoved } = renderDialog(
      ContactsMockScenario.CeMixed,
      undefined,
      undefined,
      {
        imBindingCentrallyManaged: undefined,
      },
    )
    const remove = screen.getByRole('button', { name: 'contacts.memberRemoval.remove' })

    expect(remove).toBeDisabled()
    await user.click(remove)

    expect(removeMember).not.toHaveBeenCalled()
    expect(onRemoved).not.toHaveBeenCalled()
  })

  it('offers retry after a capability failure without submitting a member removal', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    const { removeMember, onRemoved } = renderDialog(
      ContactsMockScenario.EeMixed,
      undefined,
      undefined,
      {
        imBindingCentrallyManaged: undefined,
        imBindingCapabilityError: new Error('Features unavailable'),
        retryIMBindingCapability: retry,
      },
    )

    expect(screen.getByRole('button', { name: 'contacts.memberRemoval.remove' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('contacts.directory.errorTitle')
    expect(screen.queryByText('contacts.memberRemoval.failed')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.action.retry' }))

    expect(retry).toHaveBeenCalledOnce()
    expect(removeMember).not.toHaveBeenCalled()
    expect(onRemoved).not.toHaveBeenCalled()
  })

  it('defaults EE retention to selected and submits the visible choice', async () => {
    const user = userEvent.setup()
    const { onOpenChange, onRemoved, removeMember } = renderDialog(ContactsMockScenario.EeMixed)
    const retention = screen.getByRole('checkbox', {
      name: /contacts\.memberRemoval\.keepPlatform/,
    })
    expect(retention).toBeChecked()
    await user.click(retention)
    expect(retention).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'contacts.memberRemoval.remove' }))

    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce())
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(removeMember).toHaveBeenCalledWith({ keepAsPlatformContact: false, memberId: member.id })
  })

  it('offers retention in Community edition when bindings are centrally managed', async () => {
    const user = userEvent.setup()
    const { removeMember, onRemoved } = renderDialog(ContactsMockScenario.CeMixed, undefined, true)

    expect(
      screen.getByRole('checkbox', { name: /contacts\.memberRemoval\.keepPlatform/ }),
    ).toBeChecked()
    expect(screen.getByText('contacts.memberRemoval.eeDescription')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.memberRemoval.remove' }))

    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce())
    expect(removeMember).toHaveBeenCalledWith({ keepAsPlatformContact: true, memberId: member.id })
  })

  it('does not retain a platform contact in Enterprise edition when bindings are workspace-managed', async () => {
    const user = userEvent.setup()
    const { removeMember, onRemoved } = renderDialog(ContactsMockScenario.EeMixed, undefined, false)

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText('contacts.memberRemoval.standardDescription')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.memberRemoval.remove' }))

    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce())
    expect(removeMember).toHaveBeenCalledWith({ keepAsPlatformContact: false, memberId: member.id })
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
