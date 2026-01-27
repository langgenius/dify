import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NewMCPCard from './create-card'

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

vi.mock('./modal', () => ({
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

// Mutable workspace manager state
let mockIsCurrentWorkspaceManager = true

// Mock the app context
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager,
    isCurrentWorkspaceEditor: true,
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
    mockIsCurrentWorkspaceManager = true
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
      const svgElements = document.querySelectorAll('svg')
      expect(svgElements.length).toBeGreaterThan(0)
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
  })

  describe('Non-Manager User', () => {
    it('should not render card when user is not workspace manager', () => {
      mockIsCurrentWorkspaceManager = false

      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.queryByText('tools.mcp.create.cardTitle')).not.toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should have correct card structure', () => {
      render(<NewMCPCard {...defaultProps} />, { wrapper: createWrapper() })

      const card = document.querySelector('.rounded-xl')
      expect(card).toBeInTheDocument()
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
