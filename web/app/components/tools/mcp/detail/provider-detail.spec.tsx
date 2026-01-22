import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MCPDetailPanel from './provider-detail'

type MockDetail = {
  id: string
  name: string
  type: string
  tools: unknown[]
  icon: string
}

// Mock the MCPDetailContent component since it's complex
vi.mock('./content', () => ({
  default: ({ detail, onHide, onUpdate }: { detail: MockDetail, onHide: () => void, onUpdate: (isDeleted: boolean) => void }) => (
    <div data-testid="mcp-detail-content">
      <div data-testid="detail-name">{detail.name}</div>
      <button onClick={onHide}>Close</button>
      <button onClick={() => onUpdate(false)}>Update</button>
      <button onClick={() => onUpdate(true)}>Delete</button>
    </div>
  ),
}))

// Mock the Drawer component
vi.mock('@/app/components/base/drawer', () => ({
  default: ({ isOpen, onClose, children }: { isOpen: boolean, onClose: () => void, children: ReactNode }) => {
    if (!isOpen)
      return null
    return (
      <div data-testid="drawer" onClick={onClose}>
        {children}
      </div>
    )
  },
}))

describe('MCPDetailPanel', () => {
  const mockOnUpdate = vi.fn()
  const mockOnHide = vi.fn()
  const mockOnFirstCreate = vi.fn()

  const mockDetail = {
    id: 'provider-1',
    name: 'Test Provider',
    type: 'mcp',
    tools: [],
    icon: 'test-icon',
  } as unknown as Parameters<typeof MCPDetailPanel>[0]['detail']

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should return null when detail is undefined', () => {
      const { container } = render(
        <MCPDetailPanel
          detail={undefined}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
          isTriggerAuthorize={false}
          onFirstCreate={mockOnFirstCreate}
        />,
      )

      expect(container.firstChild).toBeNull()
    })

    it('should render drawer when detail is provided', () => {
      render(
        <MCPDetailPanel
          detail={mockDetail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
          isTriggerAuthorize={false}
          onFirstCreate={mockOnFirstCreate}
        />,
      )

      expect(screen.getByTestId('drawer')).toBeInTheDocument()
    })

    it('should render MCPDetailContent with detail', () => {
      render(
        <MCPDetailPanel
          detail={mockDetail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
          isTriggerAuthorize={false}
          onFirstCreate={mockOnFirstCreate}
        />,
      )

      expect(screen.getByTestId('mcp-detail-content')).toBeInTheDocument()
      expect(screen.getByTestId('detail-name')).toHaveTextContent('Test Provider')
    })
  })

  describe('Callbacks', () => {
    it('should call onUpdate when update is triggered', () => {
      render(
        <MCPDetailPanel
          detail={mockDetail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
          isTriggerAuthorize={false}
          onFirstCreate={mockOnFirstCreate}
        />,
      )

      const updateButton = screen.getByText('Update')
      updateButton.click()

      expect(mockOnUpdate).toHaveBeenCalled()
    })

    it('should call onHide and onUpdate when delete is triggered', () => {
      render(
        <MCPDetailPanel
          detail={mockDetail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
          isTriggerAuthorize={false}
          onFirstCreate={mockOnFirstCreate}
        />,
      )

      const deleteButton = screen.getByText('Delete')
      deleteButton.click()

      expect(mockOnHide).toHaveBeenCalled()
      expect(mockOnUpdate).toHaveBeenCalled()
    })

    it('should call onHide when close is triggered', () => {
      render(
        <MCPDetailPanel
          detail={mockDetail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
          isTriggerAuthorize={false}
          onFirstCreate={mockOnFirstCreate}
        />,
      )

      const closeButton = screen.getByText('Close')
      closeButton.click()

      expect(mockOnHide).toHaveBeenCalled()
    })
  })

  describe('Props', () => {
    it('should pass isTriggerAuthorize to content', () => {
      render(
        <MCPDetailPanel
          detail={mockDetail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
          isTriggerAuthorize={true}
          onFirstCreate={mockOnFirstCreate}
        />,
      )

      expect(screen.getByTestId('mcp-detail-content')).toBeInTheDocument()
    })

    it('should pass onFirstCreate to content', () => {
      render(
        <MCPDetailPanel
          detail={mockDetail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
          isTriggerAuthorize={false}
          onFirstCreate={mockOnFirstCreate}
        />,
      )

      expect(screen.getByTestId('mcp-detail-content')).toBeInTheDocument()
    })
  })
})
