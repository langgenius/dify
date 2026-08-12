import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getStepByStepTourTargetSelector,
  STEP_BY_STEP_TOUR_TARGETS,
} from '@/app/components/step-by-step-tour/target-registry'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import NewMCPCard, { NewMCPButton } from '../create-card'

// Track the mock functions
const mockCreateMCP = vi.fn().mockResolvedValue({ id: 'new-mcp-id', name: 'New MCP' })

// Mock the service
vi.mock('@/service/use-tools', () => ({
  useCreateMCP: () => ({
    mutateAsync: mockCreateMCP,
  }),
}))

// Mock the MCP Modal
type MockMCPModalProps = {
  show: boolean
  onConfirm: (info: { name: string; server_url: string }) => void
  onHide: () => void
}

vi.mock('../modal', () => ({
  default: ({ show, onConfirm, onHide }: MockMCPModalProps) => {
    if (!show) return null
    return (
      <div data-testid="mcp-modal">
        <span>tools.mcp.modal.title</span>
        <button
          data-testid="confirm-btn"
          onClick={() => onConfirm({ name: 'Test MCP', server_url: 'https://test.com' })}
        >
          Confirm
        </button>
        <button data-testid="close-btn" onClick={onHide}>
          Close
        </button>
      </div>
    )
  },
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
    mockCreateMCP.mockClear()
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
      const clickableArea = cardTitle.closest('.group')

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
      const clickableArea = cardTitle.closest('.group')

      if (clickableArea) {
        fireEvent.click(clickableArea)

        await waitFor(() => {
          expect(screen.getByTestId('mcp-modal')).toBeInTheDocument()
        })

        // Click confirm
        const confirmBtn = screen.getByTestId('confirm-btn')
        fireEvent.click(confirmBtn)

        await waitFor(() => {
          expect(mockCreateMCP).toHaveBeenCalledWith({
            name: 'Test MCP',
            server_url: 'https://test.com',
          })
          expect(handleCreate).toHaveBeenCalled()
        })
      }
    })

    it('should close modal when close button is clicked', async () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })

      // Open the modal
      const cardTitle = screen.getByText('tools.mcp.create.cardTitle')
      const clickableArea = cardTitle.closest('.group')

      if (clickableArea) {
        fireEvent.click(clickableArea)

        await waitFor(() => {
          expect(screen.getByTestId('mcp-modal')).toBeInTheDocument()
        })

        // Click close
        const closeBtn = screen.getByTestId('close-btn')
        fireEvent.click(closeBtn)

        await waitFor(() => {
          expect(screen.queryByTestId('mcp-modal')).not.toBeInTheDocument()
        })
      }
    })
  })
})
