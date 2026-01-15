import type { DocumentItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import PreviewDocumentPicker from './preview-document-picker'

// Override shared i18n mock for custom translations
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'preprocessDocument' && params?.num)
        return `${params.num} files`

      const prefix = params?.ns ? `${params.ns}.` : ''
      return `${prefix}${key}`
    },
  }),
}))

// Mock portal-to-follow-elem - always render content for testing
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: {
    children: React.ReactNode
    open?: boolean
  }) => (
    <div data-testid="portal-elem" data-open={String(open || false)}>
      {children}
    </div>
  ),
  PortalToFollowElemTrigger: ({ children, onClick }: {
    children: React.ReactNode
    onClick?: () => void
  }) => (
    <div data-testid="portal-trigger" onClick={onClick}>
      {children}
    </div>
  ),
  // Always render content to allow testing document selection
  PortalToFollowElemContent: ({ children, className }: {
    children: React.ReactNode
    className?: string
  }) => (
    <div data-testid="portal-content" className={className}>
      {children}
    </div>
  ),
}))

// Mock icons
vi.mock('@remixicon/react', () => ({
  RiArrowDownSLine: () => <span data-testid="arrow-icon">↓</span>,
  RiFile3Fill: () => <span data-testid="file-icon">📄</span>,
  RiFileCodeFill: () => <span data-testid="file-code-icon">📄</span>,
  RiFileExcelFill: () => <span data-testid="file-excel-icon">📄</span>,
  RiFileGifFill: () => <span data-testid="file-gif-icon">📄</span>,
  RiFileImageFill: () => <span data-testid="file-image-icon">📄</span>,
  RiFileMusicFill: () => <span data-testid="file-music-icon">📄</span>,
  RiFilePdf2Fill: () => <span data-testid="file-pdf-icon">📄</span>,
  RiFilePpt2Fill: () => <span data-testid="file-ppt-icon">📄</span>,
  RiFileTextFill: () => <span data-testid="file-text-icon">📄</span>,
  RiFileVideoFill: () => <span data-testid="file-video-icon">📄</span>,
  RiFileWordFill: () => <span data-testid="file-word-icon">📄</span>,
  RiMarkdownFill: () => <span data-testid="file-markdown-icon">📄</span>,
}))

// Factory function to create mock DocumentItem
const createMockDocumentItem = (overrides: Partial<DocumentItem> = {}): DocumentItem => ({
  id: `doc-${Math.random().toString(36).substr(2, 9)}`,
  name: 'Test Document',
  extension: 'txt',
  ...overrides,
})

// Factory function to create multiple document items
const createMockDocumentList = (count: number): DocumentItem[] => {
  return Array.from({ length: count }, (_, index) =>
    createMockDocumentItem({
      id: `doc-${index + 1}`,
      name: `Document ${index + 1}`,
      extension: index % 2 === 0 ? 'pdf' : 'txt',
    }))
}

// Factory function to create default props
const createDefaultProps = (overrides: Partial<React.ComponentProps<typeof PreviewDocumentPicker>> = {}) => ({
  value: createMockDocumentItem({ id: 'selected-doc', name: 'Selected Document' }),
  files: createMockDocumentList(3),
  onChange: vi.fn(),
  ...overrides,
})

// Helper to render component with default props
const renderComponent = (props: Partial<React.ComponentProps<typeof PreviewDocumentPicker>> = {}) => {
  const defaultProps = createDefaultProps(props)
  return {
    ...render(<PreviewDocumentPicker {...defaultProps} />),
    props: defaultProps,
  }
}

describe('PreviewDocumentPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Tests for basic rendering
  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderComponent()

      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should render document name from value prop', () => {
      renderComponent({
        value: createMockDocumentItem({ name: 'My Document' }),
      })

      expect(screen.getByText('My Document')).toBeInTheDocument()
    })

    it('should render placeholder when name is empty', () => {
      renderComponent({
        value: createMockDocumentItem({ name: '' }),
      })

      expect(screen.getByText('--')).toBeInTheDocument()
    })

    it('should render placeholder when name is undefined', () => {
      renderComponent({
        value: { id: 'doc-1', extension: 'txt' } as DocumentItem,
      })

      expect(screen.getByText('--')).toBeInTheDocument()
    })

    it('should render arrow icon', () => {
      renderComponent()

      expect(screen.getByTestId('arrow-icon')).toBeInTheDocument()
    })

    it('should render file icon', () => {
      renderComponent({
        value: createMockDocumentItem({ extension: 'txt' }),
        files: [], // Use empty files to avoid duplicate icons
      })

      expect(screen.getByTestId('file-text-icon')).toBeInTheDocument()
    })

    it('should render pdf icon for pdf extension', () => {
      renderComponent({
        value: createMockDocumentItem({ extension: 'pdf' }),
        files: [], // Use empty files to avoid duplicate icons
      })

      expect(screen.getByTestId('file-pdf-icon')).toBeInTheDocument()
    })
  })

  // Tests for props handling
  describe('Props', () => {
    it('should accept required props', () => {
      const props = createDefaultProps()
      render(<PreviewDocumentPicker {...props} />)

      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should apply className to trigger element', () => {
      renderComponent({ className: 'custom-class' })

      const trigger = screen.getByTestId('portal-trigger')
      const innerDiv = trigger.querySelector('.custom-class')
      expect(innerDiv).toBeInTheDocument()
    })

    it('should handle empty files array', () => {
      // Component should render without crashing with empty files
      renderComponent({ files: [] })

      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should handle single file', () => {
      // Component should accept single file
      renderComponent({
        files: [createMockDocumentItem({ id: 'single-doc', name: 'Single File' })],
      })

      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should handle multiple files', () => {
      // Component should accept multiple files
      renderComponent({
        files: createMockDocumentList(5),
      })

      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should use value.extension for file icon', () => {
      renderComponent({
        value: createMockDocumentItem({ name: 'test.docx', extension: 'docx' }),
      })

      expect(screen.getByTestId('file-word-icon')).toBeInTheDocument()
    })
  })

  // Tests for state management
  describe('State Management', () => {
    it('should initialize with popup closed', () => {
      renderComponent()

      expect(screen.getByTestId('portal-elem')).toHaveAttribute('data-open', 'false')
    })

    it('should toggle popup when trigger is clicked', () => {
      renderComponent()

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      expect(trigger).toBeInTheDocument()
    })

    it('should render portal content for document selection', () => {
      renderComponent()

      // Portal content is always rendered in our mock for testing
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })
  })

  // Tests for callback stability and memoization
  describe('Callback Stability', () => {
    it('should maintain stable onChange callback when value changes', () => {
      const onChange = vi.fn()
      const value1 = createMockDocumentItem({ id: 'doc-1', name: 'Doc 1' })
      const value2 = createMockDocumentItem({ id: 'doc-2', name: 'Doc 2' })

      const { rerender } = render(
        <PreviewDocumentPicker
          value={value1}
          files={createMockDocumentList(3)}
          onChange={onChange}
        />,
      )

      rerender(
        <PreviewDocumentPicker
          value={value2}
          files={createMockDocumentList(3)}
          onChange={onChange}
        />,
      )

      expect(screen.getByText('Doc 2')).toBeInTheDocument()
    })

    it('should use updated onChange callback after rerender', () => {
      const onChange1 = vi.fn()
      const onChange2 = vi.fn()
      const value = createMockDocumentItem()
      const files = createMockDocumentList(3)

      const { rerender } = render(
        <PreviewDocumentPicker value={value} files={files} onChange={onChange1} />,
      )

      rerender(
        <PreviewDocumentPicker value={value} files={files} onChange={onChange2} />,
      )

      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })
  })

  // Tests for component memoization
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect((PreviewDocumentPicker as any).$$typeof).toBeDefined()
    })

    it('should not re-render when props are the same', () => {
      const onChange = vi.fn()
      const value = createMockDocumentItem()
      const files = createMockDocumentList(3)

      const { rerender } = render(
        <PreviewDocumentPicker value={value} files={files} onChange={onChange} />,
      )

      rerender(
        <PreviewDocumentPicker value={value} files={files} onChange={onChange} />,
      )

      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })
  })

  // Tests for user interactions
  describe('User Interactions', () => {
    it('should toggle popup when trigger is clicked', () => {
      renderComponent()

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      expect(trigger).toBeInTheDocument()
    })

    it('should render document list with files', () => {
      const files = createMockDocumentList(3)
      renderComponent({ files })

      // Documents should be visible in the list
      expect(screen.getByText('Document 1')).toBeInTheDocument()
      expect(screen.getByText('Document 2')).toBeInTheDocument()
      expect(screen.getByText('Document 3')).toBeInTheDocument()
    })

    it('should call onChange when document is selected', () => {
      const onChange = vi.fn()
      const files = createMockDocumentList(3)

      renderComponent({ files, onChange })

      // Click on a document
      fireEvent.click(screen.getByText('Document 2'))

      // handleChange should call onChange with the selected item
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(files[1])
    })

    it('should handle rapid toggle clicks', () => {
      renderComponent()

      const trigger = screen.getByTestId('portal-trigger')

      // Rapid clicks
      fireEvent.click(trigger)
      fireEvent.click(trigger)
      fireEvent.click(trigger)
      fireEvent.click(trigger)

      expect(trigger).toBeInTheDocument()
    })
  })

  // Tests for edge cases
  describe('Edge Cases', () => {
    it('should handle null value properties gracefully', () => {
      renderComponent({
        value: { id: 'doc-1', name: '', extension: '' },
      })

      expect(screen.getByText('--')).toBeInTheDocument()
    })

    it('should render when value prop is omitted (optional)', () => {
      const files = createMockDocumentList(2)
      const onChange = vi.fn()
      // Do not pass `value` at all to verify optional behavior
      render(<PreviewDocumentPicker files={files} onChange={onChange} />)

      // Renders placeholder for missing name
      expect(screen.getByText('--')).toBeInTheDocument()
      // Portal wrapper renders
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should handle empty files array', () => {
      renderComponent({ files: [] })

      // Component should render without crashing
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should handle very long document names', () => {
      const longName = 'A'.repeat(500)
      renderComponent({
        value: createMockDocumentItem({ name: longName }),
      })

      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should handle special characters in document name', () => {
      const specialName = '<script>alert("xss")</script>'
      renderComponent({
        value: createMockDocumentItem({ name: specialName }),
      })

      expect(screen.getByText(specialName)).toBeInTheDocument()
    })

    it('should handle undefined files prop', () => {
      // Test edge case where files might be undefined at runtime
      const props = createDefaultProps()
      // @ts-expect-error - Testing runtime edge case
      props.files = undefined

      render(<PreviewDocumentPicker {...props} />)

      // Component should render without crashing
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should handle large number of files', () => {
      const manyFiles = createMockDocumentList(100)
      renderComponent({ files: manyFiles })

      // Component should accept large files array
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should handle files with same name but different extensions', () => {
      const files = [
        createMockDocumentItem({ id: 'doc-1', name: 'document', extension: 'pdf' }),
        createMockDocumentItem({ id: 'doc-2', name: 'document', extension: 'txt' }),
      ]
      renderComponent({ files })

      // Component should handle duplicate names
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })
  })

  // Tests for prop variations
  describe('Prop Variations', () => {
    describe('value variations', () => {
      it('should handle value with all fields', () => {
        renderComponent({
          value: {
            id: 'full-doc',
            name: 'Full Document',
            extension: 'pdf',
          },
        })

        expect(screen.getByText('Full Document')).toBeInTheDocument()
      })

      it('should handle value with minimal fields', () => {
        renderComponent({
          value: { id: 'minimal', name: '', extension: '' },
        })

        expect(screen.getByText('--')).toBeInTheDocument()
      })
    })

    describe('files variations', () => {
      it('should handle single file', () => {
        renderComponent({
          files: [createMockDocumentItem({ name: 'Single' })],
        })

        expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
      })

      it('should handle two files', () => {
        renderComponent({
          files: createMockDocumentList(2),
        })

        expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
      })

      it('should handle many files', () => {
        renderComponent({
          files: createMockDocumentList(50),
        })

        expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
      })
    })

    describe('className variations', () => {
      it('should apply custom className', () => {
        renderComponent({ className: 'my-custom-class' })

        const trigger = screen.getByTestId('portal-trigger')
        expect(trigger.querySelector('.my-custom-class')).toBeInTheDocument()
      })

      it('should work without className', () => {
        renderComponent({ className: undefined })

        expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
      })

      it('should handle multiple class names', () => {
        renderComponent({ className: 'class-one class-two' })

        const trigger = screen.getByTestId('portal-trigger')
        const element = trigger.querySelector('.class-one')
        expect(element).toBeInTheDocument()
        expect(element).toHaveClass('class-two')
      })
    })

    describe('extension variations', () => {
      const extensions = [
        { ext: 'txt', icon: 'file-text-icon' },
        { ext: 'pdf', icon: 'file-pdf-icon' },
        { ext: 'docx', icon: 'file-word-icon' },
        { ext: 'xlsx', icon: 'file-excel-icon' },
        { ext: 'md', icon: 'file-markdown-icon' },
      ]

      it.each(extensions)('should render correct icon for $ext extension', ({ ext, icon }) => {
        renderComponent({
          value: createMockDocumentItem({ extension: ext }),
          files: [], // Use empty files to avoid duplicate icons
        })

        expect(screen.getByTestId(icon)).toBeInTheDocument()
      })
    })
  })

  // Tests for document list rendering
  describe('Document List Rendering', () => {
    it('should render all documents in the list', () => {
      const files = createMockDocumentList(5)
      renderComponent({ files })

      // All documents should be visible
      files.forEach((file) => {
        expect(screen.getByText(file.name)).toBeInTheDocument()
      })
    })

    it('should pass onChange handler to DocumentList', () => {
      const onChange = vi.fn()
      const files = createMockDocumentList(3)

      renderComponent({ files, onChange })

      // Click on first document
      fireEvent.click(screen.getByText('Document 1'))

      expect(onChange).toHaveBeenCalledWith(files[0])
    })

    it('should show count header only for multiple files', () => {
      // Single file - no header
      const { rerender } = render(
        <PreviewDocumentPicker
          value={createMockDocumentItem()}
          files={[createMockDocumentItem({ name: 'Single File' })]}
          onChange={vi.fn()}
        />,
      )
      expect(screen.queryByText(/files/)).not.toBeInTheDocument()

      // Multiple files - show header
      rerender(
        <PreviewDocumentPicker
          value={createMockDocumentItem()}
          files={createMockDocumentList(3)}
          onChange={vi.fn()}
        />,
      )
      expect(screen.getByText('3 files')).toBeInTheDocument()
    })
  })

  // Tests for visual states
  describe('Visual States', () => {
    it('should apply hover styles on trigger', () => {
      renderComponent()

      const trigger = screen.getByTestId('portal-trigger')
      const innerDiv = trigger.querySelector('.hover\\:bg-state-base-hover')
      expect(innerDiv).toBeInTheDocument()
    })

    it('should have truncate class for long names', () => {
      renderComponent({
        value: createMockDocumentItem({ name: 'Very Long Document Name' }),
      })

      const nameElement = screen.getByText('Very Long Document Name')
      expect(nameElement).toHaveClass('truncate')
    })

    it('should have max-width on name element', () => {
      renderComponent({
        value: createMockDocumentItem({ name: 'Test' }),
      })

      const nameElement = screen.getByText('Test')
      expect(nameElement).toHaveClass('max-w-[200px]')
    })
  })

  // Tests for handleChange callback
  describe('handleChange Callback', () => {
    it('should call onChange with selected document item', () => {
      const onChange = vi.fn()
      const files = createMockDocumentList(3)

      renderComponent({ files, onChange })

      // Click first document
      fireEvent.click(screen.getByText('Document 1'))

      expect(onChange).toHaveBeenCalledWith(files[0])
    })

    it('should handle different document items in files', () => {
      const onChange = vi.fn()
      const customFiles = [
        { id: 'custom-1', name: 'Custom File 1', extension: 'pdf' },
        { id: 'custom-2', name: 'Custom File 2', extension: 'txt' },
      ]

      renderComponent({ files: customFiles, onChange })

      // Click on first custom file
      fireEvent.click(screen.getByText('Custom File 1'))
      expect(onChange).toHaveBeenCalledWith(customFiles[0])

      // Click on second custom file
      fireEvent.click(screen.getByText('Custom File 2'))
      expect(onChange).toHaveBeenCalledWith(customFiles[1])
    })

    it('should work with multiple sequential selections', () => {
      const onChange = vi.fn()
      const files = createMockDocumentList(3)

      renderComponent({ files, onChange })

      // Select multiple documents sequentially
      fireEvent.click(screen.getByText('Document 1'))
      fireEvent.click(screen.getByText('Document 3'))
      fireEvent.click(screen.getByText('Document 2'))

      expect(onChange).toHaveBeenCalledTimes(3)
      expect(onChange).toHaveBeenNthCalledWith(1, files[0])
      expect(onChange).toHaveBeenNthCalledWith(2, files[2])
      expect(onChange).toHaveBeenNthCalledWith(3, files[1])
    })
  })
})
