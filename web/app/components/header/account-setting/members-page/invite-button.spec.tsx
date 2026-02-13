import type { AppContextValue } from '@/context/app-context'
import type { ICurrentWorkspace } from '@/models/common'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useWorkspacePermissions } from '@/service/use-workspace'
import InviteButton from './invite-button'

vi.mock('@/context/app-context')
vi.mock('@/context/global-public-context')
vi.mock('@/service/use-workspace')

describe('InviteButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAppContext).mockReturnValue({
      currentWorkspace: { id: 'workspace-id' } as ICurrentWorkspace,
    } as unknown as AppContextValue)
  })

  it('should show invite button when branding is disabled', () => {
    vi.mocked(useGlobalPublicStore).mockImplementation(selector => selector({
      systemFeatures: { branding: { enabled: false } },
    } as unknown as Parameters<typeof selector>[0]))
    vi.mocked(useWorkspacePermissions).mockReturnValue({
      data: null,
      isFetching: false,
    } as unknown as ReturnType<typeof useWorkspacePermissions>)

    render(<InviteButton />)

    expect(screen.getByRole('button', { name: /members\.invite/i })).toBeInTheDocument()
  })

  it('should show loading status while permissions are loading', () => {
    vi.mocked(useGlobalPublicStore).mockImplementation(selector => selector({
      systemFeatures: { branding: { enabled: true } },
    } as unknown as Parameters<typeof selector>[0]))
    vi.mocked(useWorkspacePermissions).mockReturnValue({
      data: null,
      isFetching: true,
    } as unknown as ReturnType<typeof useWorkspacePermissions>)

    render(<InviteButton />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should hide invite button when permission is denied', () => {
    vi.mocked(useGlobalPublicStore).mockImplementation(selector => selector({
      systemFeatures: { branding: { enabled: true } },
    } as unknown as Parameters<typeof selector>[0]))
    vi.mocked(useWorkspacePermissions).mockReturnValue({
      data: { allow_member_invite: false },
      isFetching: false,
    } as unknown as ReturnType<typeof useWorkspacePermissions>)

    render(<InviteButton />)

    expect(screen.queryByRole('button', { name: /members\.invite/i })).not.toBeInTheDocument()
  })

  it('should show invite button when permission is granted', () => {
    vi.mocked(useGlobalPublicStore).mockImplementation(selector => selector({
      systemFeatures: { branding: { enabled: true } },
    } as unknown as Parameters<typeof selector>[0]))
    vi.mocked(useWorkspacePermissions).mockReturnValue({
      data: { allow_member_invite: true },
      isFetching: false,
    } as unknown as ReturnType<typeof useWorkspacePermissions>)

    render(<InviteButton />)

    expect(screen.getByRole('button', { name: /members\.invite/i })).toBeInTheDocument()
  })
})
