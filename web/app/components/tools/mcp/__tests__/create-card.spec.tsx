import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  getStepByStepTourTargetSelector,
  STEP_BY_STEP_TOUR_TARGETS,
} from '@/app/components/step-by-step-tour/target-registry'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWithEmoji as render } from '@/test/emoji-picker'
import NewMCPCard, { NewMCPButton } from '../create-card'

// Track the mock functions
const mockCreateMCP = vi.fn().mockResolvedValue({ id: 'new-mcp-id', name: 'New MCP' })

// Mock the service
vi.mock('@/service/use-tools', () => ({
  useCreateMCP: () => ({
    mutateAsync: mockCreateMCP,
  }),
}))

const mockConsoleState = vi.hoisted(() => ({
  workspacePermissionKeys: ['mcp.manage'] as string[],
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
  }))
})

// Mock the plugins service
vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => ({
    data: { pages: [] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    isLoading: false,
    isSuccess: true,
  }),
}))

// Mock common service
vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: vi.fn().mockResolvedValue({ url: 'https://example.com/icon.png' }),
}))

describe('NewMCPCard', () => {
  const createWrapper = () => {
    return createConsoleQueryWrapper().wrapper
  }

  const defaultProps = {
    handleCreate: vi.fn(),
  }

  beforeEach(() => {
    mockCreateMCP.mockReset().mockResolvedValue({ id: 'new-mcp-id', name: 'New MCP' })
    mockConsoleState.workspacePermissionKeys = ['mcp.manage']
  })

  describe('Rendering', () => {
    it('should render card title', () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.create.cardTitle')).toBeInTheDocument()
    })

    it('should render documentation link', () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.create.cardLink')).toBeInTheDocument()
    })

    it('should render toolbar button', () => {
      render(<NewMCPButton {...defaultProps} />, { wrapper: createWrapper() })

      expect(
        screen.getByRole('button', { name: /tools\.mcp\.create\.cardTitle/i }),
      ).toBeInTheDocument()
    })

    it('should expose the tour target on the toolbar add action only', () => {
      const selector = getStepByStepTourTargetSelector(STEP_BY_STEP_TOUR_TARGETS.integrationMcpAdd)

      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })

      expect(document.querySelectorAll(selector)).toHaveLength(0)

      render(<NewMCPButton {...defaultProps} />, { wrapper: createWrapper() })

      expect(document.querySelectorAll(selector)).toHaveLength(1)
      expect(document.querySelector(selector)).toHaveTextContent('tools.mcp.create.cardTitle')
    })
  })

  describe('User Interactions', () => {
    it('should open modal when card is clicked', async () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })

      const cardTitle = screen.getByText('tools.mcp.create.cardTitle')
      const clickableArea = cardTitle.closest('button')

      if (clickableArea) {
        fireEvent.click(clickableArea)

        await waitFor(() => {
          expect(screen.getByText('tools.mcp.modal.title')).toBeInTheDocument()
        })
      }
    })

    it('should have documentation link with correct target', () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })

      const docLink = screen.getByText('tools.mcp.create.cardLink').closest('a')
      expect(docLink).toHaveAttribute('target', '_blank')
      expect(docLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should open modal when toolbar button is clicked', async () => {
      render(<NewMCPButton {...defaultProps} />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByRole('button', { name: /tools\.mcp\.create\.cardTitle/i }))

      await waitFor(() => {
        expect(screen.getByText('tools.mcp.modal.title')).toBeInTheDocument()
      })
    })
  })

  describe('mcp.manage Permission', () => {
    it('should not render card when user lacks mcp.manage', () => {
      mockConsoleState.workspacePermissionKeys = []

      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.queryByText('tools.mcp.create.cardTitle')).not.toBeInTheDocument()
    })

    it('should not render toolbar button when user lacks mcp.manage', () => {
      mockConsoleState.workspacePermissionKeys = []

      render(<NewMCPButton {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.queryByText('tools.mcp.create.cardTitle')).not.toBeInTheDocument()
    })
  })

  describe('Modal Interactions', () => {
    it('should call create function when modal confirms', async () => {
      const handleCreate = vi.fn()
      render(<NewMCPCard handleCreate={handleCreate} />, { wrapper: createWrapper() })

      // Open the modal
      const cardTitle = screen.getByText('tools.mcp.create.cardTitle')
      const clickableArea = cardTitle.closest('button')

      if (clickableArea) {
        fireEvent.click(clickableArea)

        await waitFor(() => {
          expect(screen.getByRole('dialog')).toBeInTheDocument()
        })

        // Click confirm
        fireEvent.change(screen.getByLabelText('tools.mcp.modal.serverUrl'), {
          target: { value: 'https://test.com' },
        })
        fireEvent.change(screen.getByLabelText('tools.mcp.modal.name'), {
          target: { value: 'Test MCP' },
        })
        fireEvent.change(screen.getByLabelText('tools.mcp.modal.serverIdentifier'), {
          target: { value: 'test-mcp' },
        })
        const confirmBtn = screen.getByRole('button', { name: 'tools.mcp.modal.confirm' })
        fireEvent.click(confirmBtn)

        await waitFor(() => {
          expect(mockCreateMCP).toHaveBeenCalledWith(
            expect.objectContaining({
              name: 'Test MCP',
              server_url: 'https://test.com',
            }),
          )
          expect(handleCreate).toHaveBeenCalled()
        })
      }
    })

    it('should close modal when close button is clicked', async () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })

      // Open the modal
      const cardTitle = screen.getByText('tools.mcp.create.cardTitle')
      const clickableArea = cardTitle.closest('button')

      if (clickableArea) {
        fireEvent.click(clickableArea)

        await waitFor(() => {
          expect(screen.getByRole('dialog')).toBeInTheDocument()
        })

        // Click close
        const closeBtn = screen.getByRole('button', { name: 'common.operation.close' })
        fireEvent.click(closeBtn)

        await waitFor(() => {
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        })
      }
    })
  })
  it('keeps its session when the entry disappears while awaiting the original create handoff', async () => {
    const user = userEvent.setup()
    let finishHandoff: () => void = () => {}
    const handleCreate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHandoff = resolve
        }),
    )
    const { rerender } = render(<NewMCPCard handleCreate={handleCreate} />, {
      wrapper: createWrapper(),
    })
    await user.click(screen.getByRole('button', { name: 'tools.mcp.create.cardTitle' }))
    fireEvent.change(screen.getByLabelText('tools.mcp.modal.serverUrl'), {
      target: { value: 'https://test.com' },
    })
    fireEvent.change(screen.getByLabelText('tools.mcp.modal.name'), {
      target: { value: 'New MCP' },
    })
    fireEvent.change(screen.getByLabelText('tools.mcp.modal.serverIdentifier'), {
      target: { value: 'new-mcp' },
    })
    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.confirm' }))
    expect(handleCreate).toHaveBeenCalledTimes(1)
    rerender(<NewMCPCard showEntry={false} handleCreate={handleCreate} />)
    expect(
      screen.queryByRole('button', { name: 'tools.mcp.create.cardTitle' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('tools.mcp.modal.name')).toHaveValue('New MCP')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => finishHandoff())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps a rejected toolbar creation draft and closes only after a successful retry', async () => {
    const user = userEvent.setup()
    mockCreateMCP.mockRejectedValueOnce(new Error('Create failed'))
    const handleCreate = vi.fn()
    render(<NewMCPButton handleCreate={handleCreate} />, { wrapper: createWrapper() })
    await user.click(screen.getByRole('button', { name: 'tools.mcp.create.cardTitle' }))
    fireEvent.change(screen.getByLabelText('tools.mcp.modal.serverUrl'), {
      target: { value: 'https://test.com' },
    })
    fireEvent.change(screen.getByLabelText('tools.mcp.modal.name'), {
      target: { value: 'Retry MCP' },
    })
    fireEvent.change(screen.getByLabelText('tools.mcp.modal.serverIdentifier'), {
      target: { value: 'retry-mcp' },
    })
    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.confirm' }))
    expect(handleCreate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('tools.mcp.modal.name')).toHaveValue('Retry MCP')
    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.confirm' }))
    expect(mockCreateMCP).toHaveBeenCalledTimes(2)
    expect(handleCreate).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
