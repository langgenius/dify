import type { ICurrentWorkspace } from '@/models/common'
import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import { useWorkspacePermissions } from '@/service/use-workspace'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import InviteButton from '../invite-button'

const mockConsoleStateReader = vi.hoisted(() => vi.fn())

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-id' },
  }))
})

vi.mock('@/service/use-workspace')

describe('InviteButton', () => {
  const setupPermissions = ({
    isFetching,
    allowInvite,
  }: {
    isFetching: boolean
    allowInvite?: boolean
  }) => {
    vi.mocked(useWorkspacePermissions).mockReturnValue({
      data: allowInvite === undefined ? null : { allow_member_invite: allowInvite },
      isFetching,
    } as unknown as ReturnType<typeof useWorkspacePermissions>)
  }

  const renderInviteButton = (brandingEnabled: boolean) =>
    renderWithConsoleQuery(<InviteButton />, {
      systemFeatures: { branding: { enabled: brandingEnabled } },
    })

  beforeEach(() => {
    vi.clearAllMocks()
    mockConsoleStateReader.mockReturnValue({
      currentWorkspace: { id: 'workspace-id' } as ICurrentWorkspace,
    } as unknown as ConsoleStateFixture)
  })

  it('should show invite button when branding is disabled', () => {
    setupPermissions({ isFetching: false })

    renderInviteButton(false)

    expect(screen.getByRole('button', { name: /members\.invite/i })).toBeInTheDocument()
  })

  it('should show loading status while permissions are loading', () => {
    setupPermissions({ isFetching: true })

    renderInviteButton(true)

    expect(screen.getByRole('status')).toBeInTheDocument()
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
