'use client'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import { syncDataSourceNotion, updateDataSourceNotionAction } from '@/service/common'
import { useInvalidDataSourceIntegrates } from '@/service/use-common'
import Operate from './index'

/**
 * Operate Component (Notion) Tests
 * This component provides actions like Sync, Change Pages, and Remove for Notion data sources.
 */

// Mock services and toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

vi.mock('@/service/common', () => ({
  syncDataSourceNotion: vi.fn(),
  updateDataSourceNotionAction: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useInvalidDataSourceIntegrates: vi.fn(),
}))

describe('Operate Component (Notion)', () => {
  const mockPayload = {
    id: 'test-notion-id',
    total: 5,
  }
  const mockOnAuthAgain = vi.fn()
  const mockInvalidate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useInvalidDataSourceIntegrates).mockReturnValue(mockInvalidate)
    vi.mocked(syncDataSourceNotion).mockResolvedValue({ result: 'success' })
    vi.mocked(updateDataSourceNotionAction).mockResolvedValue({ result: 'success' })
  })

  describe('Rendering', () => {
    it('should render the menu button initially', () => {
      // Act
      render(<Operate payload={mockPayload} onAuthAgain={mockOnAuthAgain} />)

      // Assert
      const menuButton = screen.getByRole('button')
      expect(menuButton).toBeInTheDocument()
      expect(menuButton).not.toHaveClass('bg-state-base-hover')
    })

    it('should open the menu and show all options when clicked', async () => {
      // Arrange
      render(<Operate payload={mockPayload} onAuthAgain={mockOnAuthAgain} />)
      const menuButton = screen.getByRole('button')

      // Act
      fireEvent.click(menuButton)

      // Assert
      expect(await screen.findByText('common.dataSource.notion.changeAuthorizedPages')).toBeInTheDocument()
      expect(screen.getByText('common.dataSource.notion.sync')).toBeInTheDocument()
      expect(screen.getByText('common.dataSource.notion.remove')).toBeInTheDocument()
      expect(screen.getByText(/5/)).toBeInTheDocument()
      expect(screen.getByText(/common.dataSource.notion.pagesAuthorized/)).toBeInTheDocument()
      expect(menuButton).toHaveClass('bg-state-base-hover')
    })
  })

  describe('Menu Actions', () => {
    it('should call onAuthAgain when Change Authorized Pages is clicked', async () => {
      // Arrange
      render(<Operate payload={mockPayload} onAuthAgain={mockOnAuthAgain} />)
      fireEvent.click(screen.getByRole('button'))
      const option = await screen.findByText('common.dataSource.notion.changeAuthorizedPages')

      // Act
      fireEvent.click(option)

      // Assert
      expect(mockOnAuthAgain).toHaveBeenCalledTimes(1)
    })

    it('should call handleSync, show success toast, and invalidate cache when Sync is clicked', async () => {
      // Arrange
      render(<Operate payload={mockPayload} onAuthAgain={mockOnAuthAgain} />)
      fireEvent.click(screen.getByRole('button'))
      const syncBtn = await screen.findByText('common.dataSource.notion.sync')

      // Act
      fireEvent.click(syncBtn)

      // Assert
      await waitFor(() => {
        expect(syncDataSourceNotion).toHaveBeenCalledWith({
          url: `/oauth/data-source/notion/${mockPayload.id}/sync`,
        })
      })
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.api.success',
      })
      expect(mockInvalidate).toHaveBeenCalledTimes(1)
    })

    it('should call handleRemove, show success toast, and invalidate cache when Remove is clicked', async () => {
      // Arrange
      render(<Operate payload={mockPayload} onAuthAgain={mockOnAuthAgain} />)
      fireEvent.click(screen.getByRole('button'))
      const removeBtn = await screen.findByText('common.dataSource.notion.remove')

      // Act
      fireEvent.click(removeBtn)

      // Assert
      await waitFor(() => {
        expect(updateDataSourceNotionAction).toHaveBeenCalledWith({
          url: `/data-source/integrates/${mockPayload.id}/disable`,
        })
      })
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.api.success',
      })
      expect(mockInvalidate).toHaveBeenCalledTimes(1)
    })
  })

  describe('State Transitions', () => {
    it('should toggle the open class on the button based on menu visibility', async () => {
      // Arrange
      render(<Operate payload={mockPayload} onAuthAgain={mockOnAuthAgain} />)
      const menuButton = screen.getByRole('button')

      // Act (Open)
      fireEvent.click(menuButton)
      // Assert
      expect(menuButton).toHaveClass('bg-state-base-hover')

      // Act (Close - click again)
      fireEvent.click(menuButton)
      // Assert
      await waitFor(() => {
        expect(menuButton).not.toHaveClass('bg-state-base-hover')
      })
    })
  })
})
