import type { ReactElement, ReactNode } from 'react'
import { fireEvent, render as renderComponent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { InputVarType } from '@/app/components/workflow/types'
import { PromptMode } from '@/models/debug'
import { createDatasetConfigsFixture } from '@/test/fixtures/debug-configuration'
import { createEmbeddedChatbotContextFixture } from '@/test/fixtures/embedded-chatbot'
import { EmbeddedChatbotContext } from '../../context'
import InputsFormContent from '../content'

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'test-token' }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock CodeEditor to trigger onChange easily
vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (v: string) => void
    placeholder: string | React.ReactNode
  }) => (
    <textarea
      data-testid="mock-code-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={typeof placeholder === 'string' ? placeholder : 'json-placeholder'}
    />
  ),
}))

// Mock FileUploaderInAttachmentWrapper to trigger onChange easily
vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({
    value,
    onChange,
  }: {
    value: File[]
    onChange: (v: File[]) => void
  }) => (
    <div data-testid="mock-file-uploader">
      <button onClick={() => onChange([new File([''], 'test.png', { type: 'image/png' })])}>
        Upload
      </button>
      <span>{value.length > 0 ? value[0]!.name : 'no file'}</span>
    </div>
  ),
}))

const mockContextValue = createEmbeddedChatbotContextFixture({
  appParams: {
    opening_statement: '',
    pre_prompt: '',
    prompt_type: PromptMode.simple,
    user_input_form: [],
    more_like_this: { enabled: false },
    suggested_questions_after_answer: { enabled: false },
    speech_to_text: { enabled: false },
    text_to_speech: { enabled: false },
    retriever_resource: { enabled: false },
    sensitive_word_avoidance: { enabled: false },
    agent_mode: { enabled: false, tools: [] },
    dataset_configs: createDatasetConfigsFixture(),
    system_parameters: {
      file_size_limit: 10,
      audio_file_size_limit: 10,
      image_file_size_limit: 10,
      video_file_size_limit: 10,
      workflow_file_upload_limit: 10,
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
  currentConversationId: '',
  currentConversationInputs: {},
  setCurrentConversationInputs: vi.fn(),
  newConversationInputs: {},
  newConversationInputsRef: { current: {} },
  handleNewConversationInputsChange: vi.fn(),
})

let context = mockContextValue
function render(ui: ReactElement) {
  function Wrapper({ children }: { children: ReactNode }) {
    const [currentInputs, setCurrentInputs] = useState(context.currentConversationInputs)
    const [newInputs, setNewInputs] = useState(context.newConversationInputs)
    const newInputsRef = useRef(newInputs)
    return (
      <EmbeddedChatbotContext.Provider
        value={{
          ...context,
          currentConversationInputs: currentInputs,
          newConversationInputs: newInputs,
          newConversationInputsRef: newInputsRef,
          setCurrentConversationInputs: (value) => {
            context.setCurrentConversationInputs(value)
            setCurrentInputs(value)
          },
          handleNewConversationInputsChange: (value) => {
            context.handleNewConversationInputsChange(value)
            newInputsRef.current = value
            setNewInputs(value)
          },
        }}
      >
        {children}
      </EmbeddedChatbotContext.Provider>
    )
  }
  return renderComponent(ui, { wrapper: Wrapper })
}

describe('InputsFormContent', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    vi.clearAllMocks()

    user = userEvent.setup()
    context = mockContextValue
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
    expect(
      within(screen.getByTestId('inputs-form-item-num_var')).getByText(/panel.optional/),
    ).toBeInTheDocument()
  })

  it('should handle text input changes', async () => {
    render(<InputsFormContent />)
    const input = screen.getByRole('textbox', { name: 'Text Label' })
    await user.type(input, 'hello')

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenLastCalledWith({
      text_var: 'hello',
    })
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenLastCalledWith({
      text_var: 'hello',
    })
  })

  it('should handle number input changes', async () => {
    render(<InputsFormContent />)
    const input = screen.getByRole('spinbutton', { name: 'Number Label' })
    await user.type(input, '123')

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenLastCalledWith({
      num_var: '123',
    })
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenLastCalledWith({
      num_var: '123',
    })
  })

  it('should handle paragraph input changes', async () => {
    render(<InputsFormContent />)
    const input = screen.getByRole('textbox', { name: 'Paragraph Label' })
    await user.type(input, 'long text')

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenLastCalledWith({
      para_var: 'long text',
    })
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenLastCalledWith({
      para_var: 'long text',
    })
  })

  it('should handle bool input changes', async () => {
    render(<InputsFormContent />)
    const checkbox = screen.getByRole('checkbox', { name: 'Bool Label' })
    await user.click(checkbox)

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenLastCalledWith({
      bool_var: true,
    })
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenLastCalledWith({
      bool_var: true,
    })
  })

  it('should handle select input changes', async () => {
    render(<InputsFormContent />)
    const selectTrigger = screen.getByRole('combobox', { name: 'Select Label' })

    await user.click(selectTrigger)
    const option = screen.getByText('Option 1')
    await user.click(option)

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenLastCalledWith({
      select_var: 'Option 1',
    })
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenLastCalledWith({
      select_var: 'Option 1',
    })
  })

  it('should handle single file upload change', async () => {
    render(<InputsFormContent />)
    await user.click(
      within(screen.getByTestId('inputs-form-item-file_var')).getByRole('button', {
        name: 'Upload',
      }),
    )

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenLastCalledWith({
      file_var: expect.objectContaining({ name: 'test.png' }),
    })
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenLastCalledWith({
      file_var: expect.objectContaining({ name: 'test.png' }),
    })
  })

  it('should handle multi files upload change', async () => {
    render(<InputsFormContent />)
    await user.click(
      within(screen.getByTestId('inputs-form-item-multi_file_var')).getByRole('button', {
        name: 'Upload',
      }),
    )

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenLastCalledWith({
      multi_file_var: [expect.objectContaining({ name: 'test.png' })],
    })
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenLastCalledWith({
      multi_file_var: [expect.objectContaining({ name: 'test.png' })],
    })
  })

  it('should handle JSON object change', async () => {
    render(<InputsFormContent />)
    const jsonEditor = screen.getByTestId('mock-code-editor')
    fireEvent.change(jsonEditor, { target: { value: '{ "a": 1 }' } })

    expect(mockContextValue.setCurrentConversationInputs).toHaveBeenLastCalledWith({
      json_var: '{ "a": 1 }',
    })
    expect(mockContextValue.handleNewConversationInputsChange).toHaveBeenLastCalledWith({
      json_var: '{ "a": 1 }',
    })
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

    context = contextWithValues

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

    context = contextWithConv

    render(<InputsFormContent />)
    expect(screen.getByDisplayValue('conv value')).toBeInTheDocument()
  })

  it('should render numeric zero from context as zero', () => {
    const contextWithZero = {
      ...mockContextValue,
      newConversationInputs: {
        num_var: 0,
      },
    }

    context = contextWithZero

    render(<InputsFormContent />)
    expect(screen.getByRole('spinbutton', { name: 'Number Label' })).toHaveValue(0)
  })
})
