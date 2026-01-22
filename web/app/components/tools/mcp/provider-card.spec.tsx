import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MCPCard from './provider-card'

type MockData = Parameters<typeof MCPCard>[0]['data']

// Mock dependencies
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
  }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (_time: number) => '2 hours ago',
  }),
}))

const mockUpdateMCP = vi.fn()
const mockDeleteMCP = vi.fn()
vi.mock('@/service/use-tools', () => ({
  useUpdateMCP: () => ({
    mutateAsync: mockUpdateMCP,
  }),
  useDeleteMCP: () => ({
    mutateAsync: mockDeleteMCP,
  }),
}))

// Mock child components
vi.mock('./detail/operation-dropdown', () => ({
  default: ({ onEdit, onRemove }: { onEdit: () => void, onRemove: () => void }) => (
    <div data-testid="operation-dropdown">
      <button data-testid="edit-btn" onClick={onEdit}>Edit</button>
      <button data-testid="remove-btn" onClick={onRemove}>Remove</button>
    </div>
  ),
}))

vi.mock('./modal', () => ({
  default: ({ show, onConfirm, onHide }: { show: boolean, onConfirm: (data: { name: string }) => void, onHide: () => void }) => {
    if (!show)
      return null
    return (
      <div data-testid="mcp-modal">
        <button onClick={() => onConfirm({ name: 'updated' })}>Save</button>
        <button onClick={onHide}>Cancel</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, onConfirm, onCancel }: { isShow: boolean, onConfirm: () => void, onCancel: () => void }) => {
    if (!isShow)
      return null
    return (
      <div data-testid="confirm-dialog">
        <button data-testid="confirm-delete" onClick={onConfirm}>Confirm Delete</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: ({ src }: { src: string }) => <div data-testid="card-icon">{src}</div>,
}))

describe('MCPCard', () => {
  const mockHandleSelect = vi.fn()
  const mockOnUpdate = vi.fn()
  const mockOnDeleted = vi.fn()

  const mockData = {
    id: 'provider-1',
    name: 'Test MCP Provider',
    icon: 'test-icon.png',
    server_identifier: 'test-server',
    tools: [{ name: 'tool1' }, { name: 'tool2' }],
    is_team_authorization: true,
    updated_at: Date.now() / 1000,
  } as unknown as MockData

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockUpdateMCP.mockResolvedValue({ result: 'success' })
    mockDeleteMCP.mockResolvedValue({ result: 'success' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      expect(screen.getByText('Test MCP Provider')).toBeInTheDocument()
    })

    it('should display provider name', () => {
      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      expect(screen.getByText('Test MCP Provider')).toBeInTheDocument()
    })

    it('should display server identifier', () => {
      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      expect(screen.getByText('test-server')).toBeInTheDocument()
    })

    it('should display tools count', () => {
      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      // i18n mock includes count parameter
      expect(screen.getByText(/tools\.mcp\.toolsCount/)).toBeInTheDocument()
    })

    it('should display "no tools" when tools array is empty', () => {
      const dataWithNoTools = { ...mockData, tools: [] } as unknown as MockData

      render(
        <MCPCard
          data={dataWithNoTools}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      expect(screen.getByText('tools.mcp.noTools')).toBeInTheDocument()
    })
  })

  describe('Selection', () => {
    it('should call handleSelect when card is clicked', async () => {
      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      const card = screen.getByText('Test MCP Provider').closest('.cursor-pointer')!

      await act(async () => {
        fireEvent.click(card)
        vi.advanceTimersByTime(10)
      })

      expect(mockHandleSelect).toHaveBeenCalledWith('provider-1')
    })

    it('should show selected state when currentProvider matches', () => {
      render(
        <MCPCard
          data={mockData}
          currentProvider={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      const card = document.querySelector('.border-components-option-card-option-selected-border')
      expect(card).toBeInTheDocument()
    })
  })

  describe('Authorization Status', () => {
    it('should show green indicator when authorized with tools', () => {
      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      // The green indicator should be present
      const indicator = document.querySelector('.shrink-0')
      expect(indicator).toBeInTheDocument()
    })

    it('should show "not configured" badge when not authorized', () => {
      const unauthorizedData = { ...mockData, is_team_authorization: false } as unknown as MockData

      render(
        <MCPCard
          data={unauthorizedData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      expect(screen.getByText('tools.mcp.noConfigured')).toBeInTheDocument()
    })
  })

  describe('Edit Operation', () => {
    it('should show update modal when edit is clicked', async () => {
      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      const editBtn = screen.getByTestId('edit-btn')

      await act(async () => {
        fireEvent.click(editBtn)
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByTestId('mcp-modal')).toBeInTheDocument()
    })

    it('should call updateMCP with correct payload when save is clicked', async () => {
      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      const editBtn = screen.getByTestId('edit-btn')

      await act(async () => {
        fireEvent.click(editBtn)
        vi.advanceTimersByTime(10)
      })

      const saveBtn = screen.getByText('Save')

      await act(async () => {
        fireEvent.click(saveBtn)
        vi.advanceTimersByTime(10)
      })

      expect(mockUpdateMCP).toHaveBeenCalledWith({
        name: 'updated',
        provider_id: 'provider-1',
      })
    })

    it('should call onUpdate and hide modal after successful update', async () => {
      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      const editBtn = screen.getByTestId('edit-btn')

      await act(async () => {
        fireEvent.click(editBtn)
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByTestId('mcp-modal')).toBeInTheDocument()

      const saveBtn = screen.getByText('Save')

      await act(async () => {
        fireEvent.click(saveBtn)
        vi.advanceTimersByTime(10)
        await Promise.resolve()
      })

      expect(mockOnUpdate).toHaveBeenCalledWith('provider-1')
      expect(screen.queryByTestId('mcp-modal')).not.toBeInTheDocument()
    })

    it('should not call onUpdate if update fails', async () => {
      mockUpdateMCP.mockResolvedValue({ result: 'error' })

      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      const editBtn = screen.getByTestId('edit-btn')

      await act(async () => {
        fireEvent.click(editBtn)
        vi.advanceTimersByTime(10)
      })

      const saveBtn = screen.getByText('Save')

      await act(async () => {
        fireEvent.click(saveBtn)
        vi.advanceTimersByTime(10)
        await Promise.resolve()
      })

      expect(mockOnUpdate).not.toHaveBeenCalled()
    })

    it('should hide modal when cancel is clicked', async () => {
      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      const editBtn = screen.getByTestId('edit-btn')

      await act(async () => {
        fireEvent.click(editBtn)
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByTestId('mcp-modal')).toBeInTheDocument()

      const cancelBtn = screen.getByText('Cancel')

      await act(async () => {
        fireEvent.click(cancelBtn)
        vi.advanceTimersByTime(10)
      })

      expect(screen.queryByTestId('mcp-modal')).not.toBeInTheDocument()
    })
  })

  describe('Delete Operation', () => {
    it('should show confirm dialog when remove is clicked', async () => {
      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      const removeBtn = screen.getByTestId('remove-btn')

      await act(async () => {
        fireEvent.click(removeBtn)
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    })

    it('should call deleteMCP and onDeleted when delete is confirmed', async () => {
      render(
        <MCPCard
          data={mockData}
          handleSelect={mockHandleSelect}
          onUpdate={mockOnUpdate}
          onDeleted={mockOnDeleted}
        />,
      )

      const removeBtn = screen.getByTestId('remove-btn')

      await act(async () => {
        fireEvent.click(removeBtn)
        vi.advanceTimersByTime(10)
      })

      const confirmBtn = screen.getByTestId('confirm-delete')

      await act(async () => {
        fireEvent.click(confirmBtn)
        vi.advanceTimersByTime(10)
      })

      expect(mockDeleteMCP).toHaveBeenCalledWith('provider-1')
    })
  })
})
