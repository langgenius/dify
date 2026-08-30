import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import Actions from '../actions'
import Operations from '../operations'

describe('TemplateCard Actions & Operations', () => {
  const defaultProps = {
    onApplyTemplate: vi.fn(),
    handleShowTemplateDetails: vi.fn(),
    showMoreOperations: true,
    openEditModal: vi.fn(),
    handleExportDSL: vi.fn(),
    handleDelete: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Actions', () => {
    it('should render primary buttons', () => {
      render(<Actions {...defaultProps} />)
      expect(
        screen.getByRole('button', { name: 'datasetPipeline.operations.choose' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'datasetPipeline.operations.details' }),
      ).toBeInTheDocument()
    })

    it('should call onApplyTemplate when Choose button is clicked', () => {
      render(<Actions {...defaultProps} />)
      fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.operations.choose' }))
      expect(defaultProps.onApplyTemplate).toHaveBeenCalledTimes(1)
    })

    it('should call handleShowTemplateDetails when Details button is clicked', () => {
      render(<Actions {...defaultProps} />)
      fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.operations.details' }))
      expect(defaultProps.handleShowTemplateDetails).toHaveBeenCalledTimes(1)
    })

    it('should not render more operations trigger when showMoreOperations is false', () => {
      render(<Actions {...defaultProps} showMoreOperations={false} />)
      expect(
        screen.queryByRole('button', { name: 'common.operation.more' }),
      ).not.toBeInTheDocument()
    })

    it('should render more operations trigger with accessible label when showMoreOperations is true', () => {
      render(<Actions {...defaultProps} showMoreOperations={true} />)
      expect(screen.getByRole('button', { name: 'common.operation.more' })).toBeInTheDocument()
    })

    it('should open dropdown menu with menu items when more trigger is clicked', async () => {
      render(<Actions {...defaultProps} />)
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(await screen.findByRole('menu')).toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: 'datasetPipeline.operations.editInfo' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: 'datasetPipeline.operations.exportPipeline' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'common.operation.delete' })).toBeInTheDocument()
    })

    it('should trigger openEditModal when Edit menu item is clicked', async () => {
      const user = userEvent.setup()
      render(<Actions {...defaultProps} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

      const editItem = await screen.findByRole('menuitem', {
        name: 'datasetPipeline.operations.editInfo',
      })
      await user.click(editItem)

      expect(defaultProps.openEditModal).toHaveBeenCalledTimes(1)
    })

    it('should trigger handleExportDSL when Export menu item is clicked', async () => {
      const user = userEvent.setup()
      render(<Actions {...defaultProps} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

      const exportItem = await screen.findByRole('menuitem', {
        name: 'datasetPipeline.operations.exportPipeline',
      })
      await user.click(exportItem)

      expect(defaultProps.handleExportDSL).toHaveBeenCalledTimes(1)
    })

    it('should trigger handleDelete when Delete menu item is clicked', async () => {
      const user = userEvent.setup()
      render(<Actions {...defaultProps} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

      const deleteItem = await screen.findByRole('menuitem', {
        name: 'common.operation.delete',
      })
      await user.click(deleteItem)

      expect(defaultProps.handleDelete).toHaveBeenCalledTimes(1)
    })
  })

  describe('Operations', () => {
    it('should render menu items inside DropdownMenu with keyboard accessibility', async () => {
      const openEditModal = vi.fn()
      const onDelete = vi.fn()
      const onExport = vi.fn()
      const onClose = vi.fn()

      render(
        <DropdownMenu open>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <Operations
              openEditModal={openEditModal}
              onDelete={onDelete}
              onExport={onExport}
              onClose={onClose}
            />
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      const menuItems = await screen.findAllByRole('menuitem')
      expect(menuItems).toHaveLength(3)

      expect(
        screen.getByRole('menuitem', { name: 'datasetPipeline.operations.editInfo' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: 'datasetPipeline.operations.exportPipeline' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'common.operation.delete' })).toBeInTheDocument()

      expect(screen.getByRole('menuitem', { name: 'common.operation.delete' })).toHaveAttribute(
        'data-variant',
        'destructive',
      )
    })
  })
})
