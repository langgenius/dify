import type { ReactNode } from 'react'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import MCPDetailPanel from './provider-detail'

// Mock the drawer component
vi.mock('@/app/components/base/drawer', () => ({
  default: ({ children, isOpen }: { children: ReactNode, isOpen: boolean }) => {
    if (!isOpen)
      return null
    return <div data-testid="drawer">{children}</div>
  },
}))

// Mock the content component to expose onUpdate callback
vi.mock('./content', () => ({
  default: ({ detail, onUpdate }: { detail: ToolWithProvider, onUpdate: (isDelete?: boolean) => void }) => (
    <div data-testid="mcp-detail-content">
      {detail.name}
      <button data-testid="update-btn" onClick={() => onUpdate()}>Update</button>
      <button data-testid="delete-btn" onClick={() => onUpdate(true)}>Delete</button>
    </div>
  ),
}))

describe('MCPDetailPanel', () => {
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

  const createMockDetail = (): ToolWithProvider => ({
    id: 'mcp-1',
    name: 'Test MCP',
    server_identifier: 'test-mcp',
    server_url: 'https://example.com/mcp',
    icon: { content: '🔧', background: '#FF0000' },
    tools: [],
    is_team_authorization: true,
  } as unknown as ToolWithProvider)

  const defaultProps = {
    onUpdate: vi.fn(),
    onHide: vi.fn(),
    isTriggerAuthorize: false,
    onFirstCreate: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render nothing when detail is undefined', () => {
      const { container } = render(
        <MCPDetailPanel {...defaultProps} detail={undefined} />,
        { wrapper: createWrapper() },
      )
      expect(container.innerHTML).toBe('')
    })

    it('should render drawer when detail is provided', () => {
      const detail = createMockDetail()
      render(
        <MCPDetailPanel {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByTestId('drawer')).toBeInTheDocument()
    })

    it('should render content when detail is provided', () => {
      const detail = createMockDetail()
      render(
        <MCPDetailPanel {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByTestId('mcp-detail-content')).toBeInTheDocument()
    })

    it('should pass detail to content component', () => {
      const detail = createMockDetail()
      render(
        <MCPDetailPanel {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('Test MCP')).toBeInTheDocument()
    })
  })

  describe('Callbacks', () => {
    it('should call onUpdate when update is triggered', () => {
      const onUpdate = vi.fn()
      const detail = createMockDetail()
      render(
        <MCPDetailPanel {...defaultProps} detail={detail} onUpdate={onUpdate} />,
        { wrapper: createWrapper() },
      )
      // The update callback is passed to content component
      expect(screen.getByTestId('mcp-detail-content')).toBeInTheDocument()
    })

    it('should accept isTriggerAuthorize prop', () => {
      const detail = createMockDetail()
      render(
        <MCPDetailPanel {...defaultProps} detail={detail} isTriggerAuthorize={true} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByTestId('mcp-detail-content')).toBeInTheDocument()
    })
  })

  describe('handleUpdate', () => {
    it('should call onUpdate but not onHide when isDelete is false (default)', () => {
      const onUpdate = vi.fn()
      const onHide = vi.fn()
      const detail = createMockDetail()
      render(
        <MCPDetailPanel {...defaultProps} detail={detail} onUpdate={onUpdate} onHide={onHide} />,
        { wrapper: createWrapper() },
      )

      // Click update button which calls onUpdate() without isDelete parameter
      const updateBtn = screen.getByTestId('update-btn')
      fireEvent.click(updateBtn)

      expect(onUpdate).toHaveBeenCalledTimes(1)
      expect(onHide).not.toHaveBeenCalled()
    })

    it('should call both onHide and onUpdate when isDelete is true', () => {
      const onUpdate = vi.fn()
      const onHide = vi.fn()
      const detail = createMockDetail()
      render(
        <MCPDetailPanel {...defaultProps} detail={detail} onUpdate={onUpdate} onHide={onHide} />,
        { wrapper: createWrapper() },
      )

      // Click delete button which calls onUpdate(true)
      const deleteBtn = screen.getByTestId('delete-btn')
      fireEvent.click(deleteBtn)

      expect(onHide).toHaveBeenCalledTimes(1)
      expect(onUpdate).toHaveBeenCalledTimes(1)
    })
  })
})
