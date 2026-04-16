import type { InputVar } from '@/models/pipeline'
import { render, screen } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import SnippetInputFieldEditor from '../input-field-editor'

const mockUseFloatingRight = vi.fn()

vi.mock('@/app/components/rag-pipeline/components/panel/input-field/hooks', () => ({
  useFloatingRight: (...args: unknown[]) => mockUseFloatingRight(...args),
}))

vi.mock('../input-field-form', () => ({
  default: ({ isEditMode }: { isEditMode: boolean }) => (
    <div data-testid="snippet-input-field-form">{isEditMode ? 'edit' : 'create'}</div>
  ),
}))

const createField = (overrides: Partial<InputVar> = {}): InputVar => ({
  type: PipelineInputVarType.textInput,
  label: 'Blog URL',
  variable: 'blog_url',
  required: true,
  options: [],
  placeholder: 'Paste a source article URL',
  max_length: 256,
  ...overrides,
})

describe('SnippetInputFieldEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseFloatingRight.mockReturnValue({
      floatingRight: false,
      floatingRightWidth: 400,
    })
  })

  // Verifies the default desktop layout keeps the editor inline with the panel.
  describe('Rendering', () => {
    it('should render the add title without floating positioning by default', () => {
      render(
        <SnippetInputFieldEditor
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      const title = screen.getByText('datasetPipeline.inputFieldPanel.addInputField')
      const editor = title.parentElement

      expect(title).toBeInTheDocument()
      expect(editor).not.toHaveClass('absolute')
      expect(editor).toHaveStyle({ width: 'min(400px, calc(100vw - 24px))' })
      expect(mockUseFloatingRight).toHaveBeenCalledWith(400)
    })

    it('should float over the panel when there is not enough room', () => {
      mockUseFloatingRight.mockReturnValue({
        floatingRight: true,
        floatingRightWidth: 320,
      })

      render(
        <SnippetInputFieldEditor
          field={createField()}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )

      const title = screen.getByText('datasetPipeline.inputFieldPanel.editInputField')
      const editor = title.parentElement

      expect(title).toBeInTheDocument()
      expect(editor).toHaveClass('absolute', 'right-0', 'z-[100]')
      expect(editor).toHaveStyle({ width: 'min(320px, calc(100vw - 24px))' })
      expect(screen.getByTestId('snippet-input-field-form')).toHaveTextContent('edit')
    })
  })
})
