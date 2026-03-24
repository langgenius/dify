import { fireEvent, render, screen } from '@testing-library/react'
import { ROOT_ID } from '../../constants'
import TreeContextMenu from './tree-context-menu'

const mocks = vi.hoisted(() => ({
  clearSelection: vi.fn(),
  deselectAll: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      clearSelection: mocks.clearSelection,
    }),
  }),
}))

vi.mock('next/dynamic', () => ({
  default: () => {
    const MockImportSkillModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
      if (!isOpen)
        return null

      return (
        <div data-testid="import-skill-modal">
          <button type="button" onClick={onClose}>
            close-import-modal
          </button>
        </div>
      )
    }

    return MockImportSkillModal
  },
}))

vi.mock('./node-menu', () => ({
  default: ({ type, menuType, nodeId, onImportSkills }: { type: string, menuType: string, nodeId?: string, onImportSkills?: () => void }) => (
    <div
      data-testid={`node-menu-${menuType}`}
      data-type={type}
      data-node-id={nodeId ?? ''}
    >
      {onImportSkills && (
        <button type="button" onClick={onImportSkills}>
          open-import-skill-modal
        </button>
      )}
    </div>
  ),
}))

describe('TreeContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render trigger children', () => {
      render(
        <TreeContextMenu treeRef={{ current: null }}>
          <div>blank area</div>
        </TreeContextMenu>,
      )

      expect(screen.getByText('blank area')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should clear selection and open root menu when blank area is right clicked', () => {
      render(
        <TreeContextMenu treeRef={{ current: { deselectAll: mocks.deselectAll } as never }}>
          <div>blank area</div>
        </TreeContextMenu>,
      )

      fireEvent.contextMenu(screen.getByText('blank area'))

      expect(mocks.deselectAll).toHaveBeenCalledTimes(1)
      expect(mocks.clearSelection).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('node-menu-context')).toHaveAttribute('data-type', 'root')
      expect(screen.getByTestId('node-menu-context')).toHaveAttribute('data-node-id', ROOT_ID)
    })

    it('should keep import modal mounted after root menu requests it', () => {
      render(
        <TreeContextMenu treeRef={{ current: { deselectAll: mocks.deselectAll } as never }}>
          <div>blank area</div>
        </TreeContextMenu>,
      )

      fireEvent.contextMenu(screen.getByText('blank area'))
      fireEvent.click(screen.getByRole('button', { name: /open-import-skill-modal/i }))

      expect(screen.getByTestId('import-skill-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByText(/close-import-modal/i))
      expect(screen.queryByTestId('import-skill-modal')).not.toBeInTheDocument()
    })
  })
})
