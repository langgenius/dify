import type { ComponentProps } from 'react'
import type { MCPServerDetail } from '@/app/components/tools/types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MCPServerModal from '../mcp-server-modal'

const mockCreateMCPServer = vi.hoisted(() => vi.fn())
const mockUpdateMCPServer = vi.hoisted(() => vi.fn())
const mockInvalidateMCPServerDetail = vi.hoisted(() => vi.fn())
const mockGetSocket = vi.hoisted(() => vi.fn())
const mockSocketEmit = vi.hoisted(() => vi.fn())

vi.mock('@/service/use-tools', () => ({
  useCreateMCPServer: () => ({
    mutateAsync: mockCreateMCPServer,
    isPending: false,
  }),
  useUpdateMCPServer: () => ({
    mutateAsync: mockUpdateMCPServer,
    isPending: false,
  }),
  useInvalidateMCPServerDetail: () => mockInvalidateMCPServerDetail,
}))

vi.mock('@/app/components/workflow/collaboration/core/websocket-manager', () => ({
  webSocketClient: {
    getSocket: mockGetSocket,
  },
}))

const renderModal = (props: Partial<ComponentProps<typeof MCPServerModal>> = {}) => {
  const onHide = vi.fn()
  const user = userEvent.setup()
  const result = render(<MCPServerModal appID="app-123" show onHide={onHide} {...props} />)

  return { ...result, onHide, user }
}

describe('MCPServerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateMCPServer.mockResolvedValue({ result: 'success' })
    mockUpdateMCPServer.mockResolvedValue({ result: 'success' })
    mockGetSocket.mockReturnValue(null)
  })

  it('does not render a dialog while closed', () => {
    render(<MCPServerModal appID="app-123" show={false} onHide={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('exposes the create dialog and description through accessible names', async () => {
    const { onHide, user } = renderModal()
    const dialog = screen.getByRole('dialog', { name: 'tools.mcp.server.modal.addTitle' })

    expect(
      within(dialog).getByRole('textbox', { name: 'tools.mcp.server.modal.description' }),
    ).toHaveValue('')
    expect(
      within(dialog).getByRole('button', { name: 'tools.mcp.server.modal.confirm' }),
    ).toBeDisabled()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))

    expect(onHide).toHaveBeenCalledOnce()
  })

  it('creates a server with the current description and parameter contract', async () => {
    mockGetSocket.mockReturnValue({ emit: mockSocketEmit })
    const { onHide, user } = renderModal({
      appInfo: { description: 'App description' },
      latestParams: [
        { variable: 'prompt', label: 'Prompt guidance', type: 'string' },
        { label: 'Missing variable', type: 'string' },
      ],
    })
    const description = screen.getByRole('textbox', {
      name: 'tools.mcp.server.modal.description',
    })

    expect(description).toHaveValue('App description')
    expect(screen.queryByText('Missing variable')).not.toBeInTheDocument()
    await user.clear(description)
    await user.type(description, 'Use this server for research tasks')
    await user.type(screen.getByRole('textbox', { name: 'Prompt guidance' }), 'Be concise')
    await user.click(screen.getByRole('button', { name: 'tools.mcp.server.modal.confirm' }))

    await waitFor(() => {
      expect(mockCreateMCPServer).toHaveBeenCalledWith({
        appID: 'app-123',
        description: 'Use this server for research tasks',
        parameters: { prompt: 'Be concise' },
      })
    })
    expect(mockInvalidateMCPServerDetail).toHaveBeenCalledWith('app-123')
    expect(mockSocketEmit).toHaveBeenCalledWith(
      'collaboration_event',
      expect.objectContaining({
        type: 'mcp_server_update',
        data: expect.objectContaining({ action: 'created' }),
        timestamp: expect.any(Number),
      }),
    )
    expect(onHide).toHaveBeenCalledOnce()
  })

  it('hydrates edit data and updates only parameters in the latest contract', async () => {
    mockGetSocket.mockReturnValue({ emit: mockSocketEmit })
    const data = {
      id: 'server-1',
      description: 'Existing description',
      parameters: {
        prompt: 'Existing guidance',
        removed_parameter: 'stale value',
      },
    } as unknown as MCPServerDetail
    const { onHide, user } = renderModal({
      data,
      appInfo: { description: 'App fallback' },
      latestParams: [{ variable: 'prompt', label: 'Prompt guidance', type: 'string' }],
    })
    const dialog = screen.getByRole('dialog', { name: 'tools.mcp.server.modal.editTitle' })
    const description = within(dialog).getByRole('textbox', {
      name: 'tools.mcp.server.modal.description',
    })
    const prompt = within(dialog).getByRole('textbox', { name: 'Prompt guidance' })

    expect(description).toHaveValue('Existing description')
    expect(prompt).toHaveValue('Existing guidance')
    await user.clear(description)
    await user.type(description, 'Updated description')
    await user.clear(prompt)
    await user.type(prompt, 'Updated guidance')
    await user.click(within(dialog).getByRole('button', { name: 'tools.mcp.modal.save' }))

    await waitFor(() => {
      expect(mockUpdateMCPServer).toHaveBeenCalledWith({
        appID: 'app-123',
        id: 'server-1',
        description: 'Updated description',
        parameters: { prompt: 'Updated guidance' },
      })
    })
    expect(mockInvalidateMCPServerDetail).toHaveBeenCalledWith('app-123')
    expect(mockSocketEmit).toHaveBeenCalledWith(
      'collaboration_event',
      expect.objectContaining({
        type: 'mcp_server_update',
        data: expect.objectContaining({ action: 'updated' }),
      }),
    )
    expect(onHide).toHaveBeenCalledOnce()
  })
})
