import { screen } from '@testing-library/react'
import { onTestFinished, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { InviteButton } from '../invite-button'

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-id' },
  }))
})

describe('InviteButton', () => {
  let queryClient: ReturnType<typeof createConsoleQueryClient>
  const setupPermissions = ({
    isFetching,
    allowInvite,
  }: {
    isFetching: boolean
    allowInvite?: boolean
  }) => {
    queryClient = createConsoleQueryClient()
    const client = queryClient
    onTestFinished(() => client.clear())
    const { queryKey } = consoleQuery.workspaces.current.permission.get.queryOptions()
    if (isFetching) {
      void queryClient.query({ queryKey, queryFn: () => new Promise(() => {}) }).catch(() => {})
      return
    }
    queryClient.setQueryData(queryKey, {
      workspace_id: 'workspace-id',
      allow_member_invite: allowInvite ?? false,
      allow_owner_transfer: false,
    })
  }

  const renderInviteButton = (brandingEnabled: boolean) =>
    renderWithConsoleQuery(<InviteButton />, {
      queryClient,
      systemFeatures: { branding: { enabled: brandingEnabled } },
    })

  it('should show invite button when branding is disabled', () => {
    setupPermissions({ isFetching: false })

    renderInviteButton(false)

    expect(screen.getByRole('button', { name: /members\.invite/i })).toBeInTheDocument()
  })

  it('should show loading status while permissions are loading', () => {
    setupPermissions({ isFetching: true })

    renderInviteButton(true)

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('should hide invite button when permission is denied', () => {
    setupPermissions({ isFetching: false, allowInvite: false })

    renderInviteButton(true)

    expect(screen.queryByRole('button', { name: /members\.invite/i })).not.toBeInTheDocument()
  })

  it('should show invite button when permission is granted', () => {
    setupPermissions({ isFetching: false, allowInvite: true })

    renderInviteButton(true)

    expect(screen.getByRole('button', { name: /members\.invite/i })).toBeInTheDocument()
  })
})
