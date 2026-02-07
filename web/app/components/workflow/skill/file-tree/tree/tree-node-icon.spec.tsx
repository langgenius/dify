import { fireEvent, render, screen } from '@testing-library/react'
import { TreeNodeIcon } from './tree-node-icon'

const mocks = vi.hoisted(() => ({
  getFileIconType: vi.fn(() => 'document'),
}))

vi.mock('../../utils/file-utils', () => ({
  getFileIconType: mocks.getFileIconType,
}))

describe('TreeNodeIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Folder nodes should render toggle affordances and icon state.
  describe('Folder nodes', () => {
    it('should render an open-folder icon when folder is expanded', () => {
      // Arrange
      render(
        <TreeNodeIcon
          isFolder
          isOpen
          fileName="assets"
          isDirty={false}
        />,
      )

      // Act
      const toggleButton = screen.getByRole('button', { name: /workflow\.skillSidebar\.toggleFolder/i })
      const icon = toggleButton.querySelector('svg')

      // Assert
      expect(toggleButton).toBeInTheDocument()
      expect(icon).toHaveClass('text-text-accent')
      expect(mocks.getFileIconType).not.toHaveBeenCalled()
    })

    it('should render a closed-folder icon when folder is collapsed', () => {
      // Arrange
      render(
        <TreeNodeIcon
          isFolder
          isOpen={false}
          fileName="assets"
          isDirty={false}
        />,
      )

      // Act
      const toggleButton = screen.getByRole('button', { name: /workflow\.skillSidebar\.toggleFolder/i })
      const icon = toggleButton.querySelector('svg')

      // Assert
      expect(icon).toHaveClass('text-text-secondary')
    })

    it('should call onToggle when folder icon button is clicked', () => {
      // Arrange
      const onToggle = vi.fn()
      render(
        <TreeNodeIcon
          isFolder
          isOpen={false}
          fileName="assets"
          isDirty={false}
          onToggle={onToggle}
        />,
      )

      // Act
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.toggleFolder/i }))

      // Assert
      expect(onToggle).toHaveBeenCalledTimes(1)
    })
  })

  // File nodes should resolve icon type and optionally show dirty indicator.
  describe('File nodes', () => {
    it('should resolve file icon type and show dirty marker when file is dirty', () => {
      // Arrange
      const { container } = render(
        <TreeNodeIcon
          isFolder={false}
          isOpen={false}
          fileName="guide.md"
          extension="md"
          isDirty
        />,
      )

      // Act
      const dirtyMarker = container.querySelector('.bg-text-warning-secondary')

      // Assert
      expect(screen.queryByRole('button', { name: /workflow\.skillSidebar\.toggleFolder/i })).not.toBeInTheDocument()
      expect(mocks.getFileIconType).toHaveBeenCalledWith('guide.md', 'md')
      expect(dirtyMarker).toBeInTheDocument()
    })

    it('should hide dirty marker when file is clean', () => {
      // Arrange
      const { container } = render(
        <TreeNodeIcon
          isFolder={false}
          isOpen={false}
          fileName="README"
          isDirty={false}
        />,
      )

      // Act
      const dirtyMarker = container.querySelector('.bg-text-warning-secondary')

      // Assert
      expect(mocks.getFileIconType).toHaveBeenCalledWith('README', undefined)
      expect(dirtyMarker).not.toBeInTheDocument()
    })
  })
})
