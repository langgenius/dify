/* eslint-disable ts/no-explicit-any */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import { useEmbeddedChatbotContext } from '../context'
import InputsFormContent from './content'

vi.mock('../context', () => ({
  useEmbeddedChatbotContext: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'test-token' }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: vi.fn() }),
}))

// Mock CodeEditor to trigger onChange easily
vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value, onChange, placeholder }: { value: string, onChange: (v: string) => void, placeholder: string | React.ReactNode }) => (
    <textarea
      data-testid="mock-code-editor"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={typeof placeholder === 'string' ? placeholder : 'json-placeholder'}
    />
  ),
}))

// Mock FileUploaderInAttachmentWrapper to trigger onChange easily
vi.mock('@/app/components/base/file-uploader', () => ({

  FileUploaderInAttachmentWrapper: ({ value, onChange }: { value: any[], onChange: (v: any[]) => void }) => (
    <div data-testid="mock-file-uploader">
      <button onClick={() => onChange([new File([''], 'test.png', { type: 'image/png' })])}>Upload</button>
      <span>{value.length > 0 ? value[0].name : 'no file'}</span>
    </div>
  ),
}))

const mockContextValue = {
  appParams: {
    system_parameters: {
      file_size_limit: 10,
    },
  },
  inputsForms: [
    {
      variable: 'text_var',
      label: 'Text Label',
      type: InputVarType.textInput,
      required: true,
    },
    {
      variable: 'num_var',
      label: 'Number Label',
      type: InputVarType.number,
      required: false,
    },
    {
      variable: 'para_var',
      label: 'Paragraph Label',
      type: InputVarType.paragraph,
      required: true,
    },
    {
      variable: 'bool_var',
      label: 'Bool Label',
      type: InputVarType.checkbox,
      required: true,
    },
    {
      variable: 'select_var',
      label: 'Select Label',
      type: InputVarType.select,
      options: ['Option 1', 'Option 2'],
      required: true,
    },
    {
      variable: 'file_var',
      label: 'File Label',
      type: InputVarType.singleFile,
      required: true,
      allowed_file_types: ['image'],
      allowed_file_extensions: ['.png'],
      allowed_file_upload_methods: ['local_upload'],
    },
    {
      variable: 'multi_file_var',
      label: 'Multi File Label',
      type: InputVarType.multiFiles,
      required: true,
      max_length: 5,
      allowed_file_types: ['image'],
      allowed_file_extensions: ['.png'],
      allowed_file_upload_methods: ['local_upload'],
    },
    {
      variable: 'json_var',
      label: 'JSON Label',
      type: InputVarType.jsonObject,
      required: true,
      json_schema: '{ "type": "object" }',
    },
    {
      variable: 'hidden_var',
      label: 'Hidden Label',
      type: InputVarType.textInput,
      hide: true,
    },
  ],
  currentConversationId: null,
  currentConversationInputs: {},
  setCurrentConversationInputs: vi.fn(),
  newConversationInputs: {},
  newConversationInputsRef: { current: {} },
  handleNewConversationInputsChange: vi.fn(),
}

describe('InputsFormContent', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useEmbeddedChatbotContext).mockReturnValue(mockContextValue as unknown as any)
  })

  it('should render visible input forms', () => {
    render(<InputsFormContent />)

    expect(screen.getAllByText(/Text Label/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Number Label/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Paragraph Label/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Bool Label/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Select Label/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/File Label/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Multi File Label/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/JSON Label/i).length).toBeGreaterThan(0)
    expect(screen.queryByText('Hidden Label')).not.toBeInTheDocument()
  })

  it('should render optional label for non-required fields', () => {
    render(<InputsFormContent />)
    expect(screen.queryAllByText(/panel.optional/i).length).toBeGreaterThan(0)
  })

  it('should handle text input changes', async () => {
    render(<InputsFormContent />)
    const inputs = screen.getAllByPlaceholderText('Text Label')
    await user.type(inputs[0], 'hello')

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenCalled()
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenCalled()
  })

  it('should handle number input changes', async () => {
    render(<InputsFormContent />)
    const inputs = screen.getAllByPlaceholderText('Number Label')
    await user.type(inputs[0], '123')

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenCalled()
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenCalled()
  })

  it('should handle paragraph input changes', async () => {
    render(<InputsFormContent />)
    const inputs = screen.getAllByPlaceholderText('Paragraph Label')
    await user.type(inputs[0], 'long text')

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenCalled()
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenCalled()
  })

  it('should handle bool input changes', async () => {
    render(<InputsFormContent />)
    const checkbox = screen.getByTestId(/checkbox-/i)
    await user.click(checkbox)

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenCalled()
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenCalled()
  })

  it('should handle select input changes', async () => {
    render(<InputsFormContent />)
    const selectTrigger = screen.getAllByText(/Select Label/i).find(el => el.tagName === 'SPAN')
    if (!selectTrigger)
      throw new Error('Select trigger not found')

    await user.click(selectTrigger)
    const option = screen.getByText('Option 1')
    await user.click(option)

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenCalled()
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenCalled()
  })

  it('should handle single file upload change', async () => {
    render(<InputsFormContent />)
    const uploadButtons = screen.getAllByText('Upload')
    await user.click(uploadButtons[0]) // First one is single file

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenCalled()
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenCalled()
  })

  it('should handle multi files upload change', async () => {
    render(<InputsFormContent />)
    const uploadButtons = screen.getAllByText('Upload')
    await user.click(uploadButtons[1]) // Second one is multi files

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenCalled()
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenCalled()
  })

  it('should handle JSON object change', async () => {
    render(<InputsFormContent />)
    const jsonEditor = screen.getByTestId('mock-code-editor')
    fireEvent.change(jsonEditor, { target: { value: '{ "a": 1 }' } })

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenCalled()
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenCalled()
  })

  it('should show tip when showTip is true', () => {
    render(<InputsFormContent showTip />)
    expect(screen.getByText(/chat.chatFormTip/i)).toBeInTheDocument()
  })

  it('should set initial values from context', () => {
    const contextWithValues = {
      ...mockContextValue,
      newConversationInputs: {
        text_var: 'initial value',
      },
    }

    vi.mocked(useEmbeddedChatbotContext).mockReturnValue(contextWithValues as unknown as any)

    render(<InputsFormContent />)
    expect(screen.getByDisplayValue('initial value')).toBeInTheDocument()
  })

  it('should use currentConversationInputs when currentConversationId exists', () => {
    const contextWithConv = {
      ...mockContextValue,
      currentConversationId: 'conv-id',
      currentConversationInputs: {
        text_var: 'conv value',
      },
    }

    vi.mocked(useEmbeddedChatbotContext).mockReturnValue(contextWithConv as unknown as any)

    render(<InputsFormContent />)
    expect(screen.getByDisplayValue('conv value')).toBeInTheDocument()
  })
})
