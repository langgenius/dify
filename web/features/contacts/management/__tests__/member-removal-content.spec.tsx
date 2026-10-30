import type { AccountWithRoleResponse as Member } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ContactsFeatureContextValue } from '../types'
import { AlertDialog, AlertDialogContent } from '@langgenius/dify-ui/alert-dialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ContactsManagementProvider } from '../composition'
import { useRemoveContactMember } from '../hooks'
import { MemberRemovalContactImpactContent } from '../member-removal-content'
import { createContactsMockRepository } from './fixtures/repository'
import { ContactsMockScenario, createContactsMockScenario } from './fixtures/scenarios'

const member: Member = {
  avatar: '',
  avatar_url: '',
  created_at: 1731000000,
  email: 'owner@example.com',
  id: 'member-owner',
  last_active_at: 1731000000,
  last_login_at: 1731000000,
  name: 'Ralph Edwards',
  role: 'admin',
  roles: [],
  status: 'active',
}

function renderDialog(
  scenarioName: ContactsMockScenario,
  wait?: () => Promise<void>,
  imCentrallyManaged?: boolean,
  capabilityState: Partial<
    Pick<
      ContactsFeatureContextValue,
      'imCentrallyManaged' | 'imCapabilityError' | 'retryIMCapability'
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
    imCentrallyManaged: imCentrallyManaged ?? baseScenario.imCentrallyManaged,
  }
  const repository = createContactsMockRepository({ scenario, wait })
  const removeMember = vi.spyOn(repository, 'removeMember')
  function RemovalDialog() {
    const removal = useRemoveContactMember()
    const [open, setOpen] = useState(true)
    return (
      <AlertDialog
        open={open}
        onOpenChange={(nextOpen) => {
          onOpenChange(nextOpen)
          setOpen(nextOpen)
        }}
      >
        <AlertDialogContent>
          <MemberRemovalContactImpactContent
            member={member}
            removal={removal}
            onRemoved={() => {
              onRemoved()
              setOpen(false)
            }}
          />
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  render(
    <QueryClientProvider client={queryClient}>
      <ContactsManagementProvider
        context={{
          deployment: scenario.deployment,
          imCentrallyManaged: scenario.imCentrallyManaged,
          permissions: scenario.permissions,
          workspaceId: scenario.workspaceId,
          ...capabilityState,
        }}
        repository={repository}
      >
        <RemovalDialog />
      </ContactsManagementProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, onRemoved, removeMember }
}

describe('MemberRemovalContactImpactContent', () => {
  it('does not allow removal before the binding capability is known', async () => {
    const user = userEvent.setup()
    const { removeMember, onRemoved } = renderDialog(
      ContactsMockScenario.CeMixed,
      undefined,
      undefined,
      {
        imCentrallyManaged: undefined,
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
        imCentrallyManaged: undefined,
        imCapabilityError: new Error('Features unavailable'),
        retryIMCapability: retry,
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
    const { onRemoved, removeMember } = renderDialog(ContactsMockScenario.EeMixed)
    const retention = screen.getByRole('checkbox', {
      name: /contacts\.memberRemoval\.keepPlatform/,
    })
    expect(retention).toBeChecked()
    await user.click(retention)
    expect(retention).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'contacts.memberRemoval.remove' }))

    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
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
    expect(pendingButton).toHaveAttribute('aria-disabled', 'true')
    expect(onRemoved).not.toHaveBeenCalled()
    await act(async () => resolveRemoval?.())
    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce())
  })
})
