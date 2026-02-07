import type { AppAssetTreeView } from '@/types/app-asset'
import { render, screen } from '@testing-library/react'
import { ROOT_ID } from '../../constants'
import DragActionTooltip from './drag-action-tooltip'

type MockWorkflowState = {
  dragOverFolderId: string | null
}

const mocks = vi.hoisted(() => ({
  storeState: {
    dragOverFolderId: null,
  } as MockWorkflowState,
  nodeMap: undefined as Map<string, AppAssetTreeView> | undefined,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockWorkflowState) => unknown) => selector(mocks.storeState),
}))

vi.mock('../../hooks/file-tree/data/use-skill-asset-tree', () => ({
  useSkillAssetNodeMap: () => ({ data: mocks.nodeMap }),
}))

const createNode = (overrides: Partial<AppAssetTreeView> = {}): AppAssetTreeView => ({
  id: 'folder-1',
  node_type: 'folder',
  name: 'assets',
  path: '/assets',
  extension: '',
  size: 0,
  children: [],
  ...overrides,
})

const setDragOverFolderId = (value: string | null) => {
  mocks.storeState.dragOverFolderId = value
}

const setNodeMap = (nodes: AppAssetTreeView[] = []) => {
  mocks.nodeMap = new Map(nodes.map(node => [node.id, node]))
}

describe('DragActionTooltip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setDragOverFolderId(null)
    setNodeMap([])
  })

  // Tooltip should only render while dragging over a valid target.
  describe('Rendering', () => {
    it('should render nothing when dragOverFolderId is null', () => {
      // Arrange
      setDragOverFolderId(null)

      // Act
      const { container } = render(<DragActionTooltip action="upload" />)

      // Assert
      expect(container.firstChild).toBeNull()
    })

    it('should render upload action and root folder label for root target', () => {
      // Arrange
      setDragOverFolderId(ROOT_ID)

      // Act
      render(<DragActionTooltip action="upload" />)

      // Assert
      expect(screen.getByText(/workflow\.skillSidebar\.dragAction\.uploadTo/i)).toBeInTheDocument()
      expect(screen.getByText('workflow.skillSidebar.rootFolder')).toBeInTheDocument()
    })
  })

  // Target path resolution should normalize node paths.
  describe('Path resolution', () => {
    it('should strip leading slash from node path for move action', () => {
      // Arrange
      setDragOverFolderId('folder-1')
      setNodeMap([createNode({ id: 'folder-1', path: '/skills/assets' })])

      // Act
      render(<DragActionTooltip action="move" />)

      // Assert
      expect(screen.getByText(/workflow\.skillSidebar\.dragAction\.moveTo/i)).toBeInTheDocument()
      expect(screen.getByText('skills/assets')).toBeInTheDocument()
    })

    it('should keep path unchanged when it does not start with slash', () => {
      // Arrange
      setDragOverFolderId('folder-1')
      setNodeMap([createNode({ id: 'folder-1', path: 'relative/path' })])

      // Act
      render(<DragActionTooltip action="move" />)

      // Assert
      expect(screen.getByText('relative/path')).toBeInTheDocument()
    })

    it('should render nothing when target node path is missing', () => {
      // Arrange
      setDragOverFolderId('missing-folder')
      setNodeMap([createNode({ id: 'folder-1' })])

      // Act
      const { container } = render(<DragActionTooltip action="upload" />)

      // Assert
      expect(container.firstChild).toBeNull()
    })
  })
})
