import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  onConfirm: (info: { name: string, server_url: string }) => void
  onHide: () => void
}

vi.mock('../modal', () => ({
  default: ({ show, onConfirm, onHide }: MockMCPModalProps) => {
    if (!show)
      return null
    return (
      <div data-testid="mcp-modal">
        <span>tools.mcp.modal.title</span>
        <button data-testid="confirm-btn" onClick={() => onConfirm({ name: 'Test MCP', server_url: 'https://test.com' })}>
          Confirm
        </button>
        <button data-testid="close-btn" onClick={onHide}>
          Close
        </button>
      </div>
    )
  },
}))

let mockWorkspacePermissionKeys: string[] = ['mcp.manage']

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: { workspacePermissionKeys: string[] }) => unknown) => selector({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }),
}))

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
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    return ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)
  }

  const defaultProps = {
    handleCreate: vi.fn(),
  }

  beforeEach(() => {
    mockCreateMCP.mockClear()
    mockWorkspacePermissionKeys = ['mcp.manage']
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.create.cardTitle')).toBeInTheDocument()
    })

    it('should render card title', () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.create.cardTitle')).toBeInTheDocument()
    })

    it('should render documentation link', () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.create.cardLink')).toBeInTheDocument()
    })

    it('should render add icon', () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })
      expect(document.querySelector('.border-dashed')).toBeInTheDocument()
    })

    it('should render toolbar button', () => {
      render(<NewMCPButton {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByRole('button', { name: /tools\.mcp\.create\.cardTitle/i })).toBeInTheDocument()
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
      mockWorkspacePermissionKeys = []

      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.queryByText('tools.mcp.create.cardTitle')).not.toBeInTheDocument()
    })

    it('should not render toolbar button when user lacks mcp.manage', () => {
      mockWorkspacePermissionKeys = []

      render(<NewMCPButton {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.queryByText('tools.mcp.create.cardTitle')).not.toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should match the Figma card shell and section sizing', () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })

      const card = screen.getByText('tools.mcp.create.cardTitle').closest('.col-span-1')
      expect(card).toHaveClass(
        'h-[120px]',
        'overflow-hidden',
        'rounded-xl',
        'border-[0.5px]',
        'border-components-panel-border',
        'bg-components-panel-on-panel-item-bg',
        'shadow-md',
      )

      const header = screen.getByRole('button', { name: 'tools.mcp.create.cardTitle' })
      expect(header).toHaveClass('h-[84px]', 'gap-3', 'p-4')

      const docLink = screen.getByText('tools.mcp.create.cardLink').closest('a')
      expect(docLink).toHaveClass('h-8', 'border-t', 'border-divider-subtle', 'px-3', 'py-2')
    })

    it('should have clickable cursor style', () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })

      const card = document.querySelector('.cursor-pointer')
      expect(card).toBeInTheDocument()
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
