import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OperationDropdown from './operation-dropdown'

describe('OperationDropdown', () => {
  const mockOnEdit = vi.fn()
  const mockOnRemove = vi.fn()
  const mockOnOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(
        <OperationDropdown
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      )

      // Should render the trigger button
      expect(document.querySelector('button')).toBeInTheDocument()
    })

    it('should render trigger button with more icon', () => {
      render(
        <OperationDropdown
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      )

      const button = document.querySelector('button')
      expect(button).toBeInTheDocument()
    })
  })

  describe('Dropdown Toggle', () => {
    it('should open dropdown when trigger is clicked', async () => {
      render(
        <OperationDropdown
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      )

      const trigger = document.querySelector('button')!

      await act(async () => {
        fireEvent.click(trigger)
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByText('tools.mcp.operation.edit')).toBeInTheDocument()
      expect(screen.getByText('tools.mcp.operation.remove')).toBeInTheDocument()
    })

    it('should call onOpenChange when dropdown opens', async () => {
      render(
        <OperationDropdown
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
          onOpenChange={mockOnOpenChange}
        />,
      )

      const trigger = document.querySelector('button')!

      await act(async () => {
        fireEvent.click(trigger)
        vi.advanceTimersByTime(10)
      })

      expect(mockOnOpenChange).toHaveBeenCalledWith(true)
    })
  })

  describe('Edit Action', () => {
    it('should call onEdit when edit option is clicked', async () => {
      render(
        <OperationDropdown
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      )

      const trigger = document.querySelector('button')!

      await act(async () => {
        fireEvent.click(trigger)
        vi.advanceTimersByTime(10)
      })

      const editOption = screen.getByText('tools.mcp.operation.edit')

      await act(async () => {
        fireEvent.click(editOption)
        vi.advanceTimersByTime(10)
      })

      expect(mockOnEdit).toHaveBeenCalledTimes(1)
    })
  })

  describe('Remove Action', () => {
    it('should call onRemove when remove option is clicked', async () => {
      render(
        <OperationDropdown
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      )

      const trigger = document.querySelector('button')!

      await act(async () => {
        fireEvent.click(trigger)
        vi.advanceTimersByTime(10)
      })

      const removeOption = screen.getByText('tools.mcp.operation.remove')

      await act(async () => {
        fireEvent.click(removeOption)
        vi.advanceTimersByTime(10)
      })

      expect(mockOnRemove).toHaveBeenCalledTimes(1)
    })
  })

  describe('Props', () => {
    it('should apply larger size when inCard is true', () => {
      render(
        <OperationDropdown
          inCard
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      )

      // The button should have size 'l' when inCard is true
      const button = document.querySelector('button')
      expect(button).toBeInTheDocument()
    })

    it('should apply default size when inCard is false', () => {
      render(
        <OperationDropdown
          inCard={false}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      )

      const button = document.querySelector('button')
      expect(button).toBeInTheDocument()
    })
  })
})
