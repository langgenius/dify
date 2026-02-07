import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import FileTabItem from './file-tab-item'

type FileTabItemProps = ComponentProps<typeof FileTabItem>

const createProps = (overrides: Partial<FileTabItemProps> = {}) => {
  const onClick = vi.fn()
  const onClose = vi.fn()
  const onDoubleClick = vi.fn()

  const props: FileTabItemProps = {
    fileId: 'file-1',
    name: 'readme.md',
    extension: 'md',
    isActive: false,
    isDirty: false,
    isPreview: false,
    onClick,
    onClose,
    onDoubleClick,
    ...overrides,
  }

  return { props, onClick, onClose, onDoubleClick }
}

describe('FileTabItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering behavior for the tab label and close action.
  describe('Rendering', () => {
    it('should render the file tab button and close button', () => {
      const { props } = createProps()

      render(<FileTabItem {...props} />)

      expect(screen.getByRole('button', { name: /readme\.md/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.close/i })).toBeInTheDocument()
    })

    it('should style the file name as preview when isPreview is true', () => {
      const { props } = createProps({ isPreview: true })

      render(<FileTabItem {...props} />)

      expect(screen.getByText('readme.md')).toHaveClass('italic')
    })
  })

  // Pointer interactions should trigger the corresponding callbacks.
  describe('Interactions', () => {
    it('should call onClick with file id when the tab is clicked', () => {
      const { props, onClick } = createProps()

      render(<FileTabItem {...props} />)
      fireEvent.click(screen.getByRole('button', { name: /readme\.md/i }))

      expect(onClick).toHaveBeenCalledTimes(1)
      expect(onClick).toHaveBeenCalledWith('file-1')
    })

    it('should call onDoubleClick with file id when preview tab is double clicked', () => {
      const { props, onDoubleClick } = createProps({ isPreview: true })

      render(<FileTabItem {...props} />)
      fireEvent.doubleClick(screen.getByRole('button', { name: /readme\.md/i }))

      expect(onDoubleClick).toHaveBeenCalledTimes(1)
      expect(onDoubleClick).toHaveBeenCalledWith('file-1')
    })

    it('should not call onDoubleClick when tab is not in preview mode', () => {
      const { props, onDoubleClick } = createProps({ isPreview: false })

      render(<FileTabItem {...props} />)
      fireEvent.doubleClick(screen.getByRole('button', { name: /readme\.md/i }))

      expect(onDoubleClick).not.toHaveBeenCalled()
    })

    it('should call onClose and stop propagation when close button is clicked', () => {
      const parentClick = vi.fn()
      const { props, onClose } = createProps()

      render(
        <div onClick={parentClick}>
          <FileTabItem {...props} />
        </div>,
      )
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.close/i }))

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledWith('file-1')
      expect(parentClick).not.toHaveBeenCalled()
    })
  })
})
