import type { AppContextStateMockState } from '@/__tests__/utils/mock-app-context-state'
import type { ICurrentWorkspace } from '@/models/common'
import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { useWorkspacePermissions } from '@/service/use-workspace'
import InviteButton from '../invite-button'

const mockUseAppContext = vi.hoisted(() => vi.fn())

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    currentWorkspace: { id: 'workspace-id' },
  }))
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    currentWorkspace: { id: 'workspace-id' },
  }))
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    currentWorkspace: { id: 'workspace-id' },
  }))
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    currentWorkspace: { id: 'workspace-id' },
  }))
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    currentWorkspace: { id: 'workspace-id' },
  }))
})
vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } =
    await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
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
    renderWithSystemFeatures(<InviteButton />, {
      systemFeatures: { branding: { enabled: brandingEnabled } },
    })

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAppContext.mockReturnValue({
      currentWorkspace: { id: 'workspace-id' } as ICurrentWorkspace,
    } as unknown as AppContextStateMockState)
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
