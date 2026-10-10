import type { WorkspacePermissionResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import { vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { InviteButton } from '../invite-button'

const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: mockRequest,
}))

const permissionResponse = (allowInvite: boolean, workspaceId = 'workspace-id') =>
  new Response(
    JSON.stringify({
      workspace_id: workspaceId,
      allow_member_invite: allowInvite,
      allow_owner_transfer: false,
    } satisfies WorkspacePermissionResponse),
    { headers: { 'content-type': 'application/json' } },
  )

describe('InviteButton', () => {
  const renderInviteButton = (brandingEnabled: boolean, workspaceId = 'workspace-id') =>
    renderWithConsoleQuery(<InviteButton />, {
      systemFeatures: { branding: { enabled: brandingEnabled } },
      currentWorkspace: { id: workspaceId },
    })

  beforeEach(() => {
    mockRequest.mockReset()
    mockRequest.mockImplementation(() => new Promise<Response>(() => {}))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should show the invite button without fetching permissions when branding is disabled', () => {
    renderInviteButton(false)

    expect(screen.getByRole('button', { name: /members\.invite/i })).toBeInTheDocument()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('should not fetch permissions or show the invite button before a workspace is available', () => {
    renderInviteButton(true, '')

    expect(mockRequest).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /members\.invite/i })).not.toBeInTheDocument()
  })

  it('should show loading status while permissions are loading', () => {
    renderInviteButton(true)

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /members\.invite/i })).not.toBeInTheDocument()
  })

  it('should hide the invite button when permission is denied', async () => {
    mockRequest.mockResolvedValue(permissionResponse(false))

    renderInviteButton(true)

    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /members\.invite/i })).not.toBeInTheDocument()
  })

  it('should fetch the generated permission endpoint and show the invite button when allowed', async () => {
    mockRequest.mockResolvedValue(permissionResponse(true))

    renderInviteButton(true)

    expect(await screen.findByRole('button', { name: /members\.invite/i })).toBeInTheDocument()
    expect(mockRequest).toHaveBeenCalledOnce()
    expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining('/console/api/workspaces/current/permission'),
      expect.anything(),
      expect.objectContaining({
        fetchCompat: true,
        request: expect.objectContaining({ method: 'GET' }),
      }),
    )
  })

  it('should hide the invite button when the permission request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRequest.mockRejectedValue(new Error('Permission service unavailable'))

    renderInviteButton(true)

    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /members\.invite/i })).not.toBeInTheDocument()
  })

  it('should fetch permissions again without reusing an invitation grant from another workspace', async () => {
    mockRequest.mockResolvedValueOnce(permissionResponse(true))
    let resolveNextPermissions!: (response: Response) => void
    mockRequest.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveNextPermissions = resolve
        }),
    )
    const { queryClient } = renderInviteButton(true)

    expect(await screen.findByRole('button', { name: /members\.invite/i })).toBeInTheDocument()

    act(() => {
      queryClient.setQueryData(consoleQuery.workspaces.current.summary.get.queryKey(), {
        id: 'workspace-2',
        name: 'Second workspace',
        role: 'owner',
        plan: null,
        credits: null,
      })
    })

    expect(await screen.findByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /members\.invite/i })).not.toBeInTheDocument()
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2))

    await act(async () => resolveNextPermissions(permissionResponse(false, 'workspace-2')))

    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /members\.invite/i })).not.toBeInTheDocument()
  })
})
