import type { ReactElement, ReactNode } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { fileUpload } from '@/app/components/base/file-uploader/utils'
import { InputVarType } from '@/app/components/workflow/types'
import { PromptMode } from '@/models/debug'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetConfigsFixture } from '@/test/fixtures/debug-configuration'
import { createEmbeddedChatbotContextFixture } from '@/test/fixtures/embedded-chatbot'
import { TransferMethod } from '@/types/app'
import { EmbeddedChatbotContext } from '../../context'
import InputsFormContent from '../content'

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'test-token' }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/app/components/base/file-uploader/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/file-uploader/utils')>()),
  fileUpload: vi.fn(),
}))

const baseContext = createEmbeddedChatbotContextFixture({
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
      allowed_file_upload_methods: [TransferMethod.local_file],
    },
    {
      variable: 'multi_file_var',
      label: 'Multi File Label',
      type: InputVarType.multiFiles,
      required: true,
      max_length: 5,
      allowed_file_types: ['image'],
      allowed_file_extensions: ['.png'],
      allowed_file_upload_methods: [TransferMethod.local_file],
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
  newConversationInputs: {},
  newConversationInputsRef: { current: {} },
})

let context = baseContext
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
            setCurrentInputs(value)
          },
          handleNewConversationInputsChange: (value) => {
            newInputsRef.current = value
            setNewInputs(value)
          },
        }}
      >
        {children}
        <output aria-label="Current conversation inputs">{JSON.stringify(currentInputs)}</output>
        <output aria-label="New conversation inputs">{JSON.stringify(newInputs)}</output>
      </EmbeddedChatbotContext.Provider>
    )
  }
  return renderWithConsoleQuery(<Wrapper>{ui}</Wrapper>)
}

const currentInputs = () =>
  JSON.parse(screen.getByLabelText('Current conversation inputs').textContent!)
const newInputs = () => JSON.parse(screen.getByLabelText('New conversation inputs').textContent!)

describe('InputsFormContent', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    vi.mocked(fileUpload)
      .mockReset()
      .mockImplementation(({ file, onSuccessCallback }) => {
        onSuccessCallback({
          id: 'uploaded-file',
          name: file.name,
          size: file.size,
          mime_type: file.type,
          extension: 'png',
          created_at: 0,
          created_by: 'user-1',
          source_url: '',
          preview_url: null,
        })
      })

    user = userEvent.setup()
    context = baseContext
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

    expect(currentInputs()).toEqual({
      text_var: 'hello',
    })
    expect(newInputs()).toEqual({
      text_var: 'hello',
    })
  })

  it('should handle number input changes', async () => {
    render(<InputsFormContent />)
    const input = screen.getByRole('spinbutton', { name: 'Number Label' })
    await user.type(input, '123')

    expect(currentInputs()).toEqual({
      num_var: '123',
    })
    expect(newInputs()).toEqual({
      num_var: '123',
    })
  })

  it('should handle paragraph input changes', async () => {
    render(<InputsFormContent />)
    const input = screen.getByRole('textbox', { name: 'Paragraph Label' })
    await user.type(input, 'long text')

    expect(currentInputs()).toEqual({
      para_var: 'long text',
    })
    expect(newInputs()).toEqual({
      para_var: 'long text',
    })
  })

  it('should handle bool input changes', async () => {
    render(<InputsFormContent />)
    const checkbox = screen.getByRole('checkbox', { name: 'Bool Label' })
    await user.click(checkbox)

    expect(currentInputs()).toEqual({
      bool_var: true,
    })
    expect(newInputs()).toEqual({
      bool_var: true,
    })
  })

  it('should handle select input changes', async () => {
    render(<InputsFormContent />)
    const selectTrigger = screen.getByRole('combobox', { name: 'Select Label' })

    await user.click(selectTrigger)
    const option = screen.getByText('Option 1')
    await user.click(option)

    expect(currentInputs()).toEqual({
      select_var: 'Option 1',
    })
    expect(newInputs()).toEqual({
      select_var: 'Option 1',
    })
  })

  it.each([
    { variable: 'file_var', array: false },
    { variable: 'multi_file_var', array: true },
  ])(
    'uploads $variable and saves the expected scalar or list shape',
    async ({ variable, array }) => {
      render(<InputsFormContent />)
      const input = screen
        .getByTestId(`inputs-form-item-${variable}`)
        .querySelector<HTMLInputElement>('input[type="file"]')!
      const file = new File(['image'], 'test.png', { type: 'image/png' })
      await user.upload(input, file)
      const uploaded = expect.objectContaining({
        name: 'test.png',
        uploadedId: 'uploaded-file',
        progress: 100,
        transferMethod: TransferMethod.local_file,
      })
      const value = array ? [uploaded] : uploaded
      await waitFor(() => expect(currentInputs()).toEqual({ [variable]: value }))
      expect(newInputs()).toEqual({ [variable]: value })
      expect(fileUpload).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ file }),
        true,
        undefined,
      )
    },
  )

  it('should handle JSON object change', async () => {
    render(<InputsFormContent />)
    // Monaco is the external editor boundary provided by vitest.setup.ts.
    const jsonEditor = screen.getByTestId('monaco-editor')
    await user.click(jsonEditor)
    await user.paste('{ "a": 1 }')
    expect(jsonEditor).toHaveValue('{ "a": 1 }')

    expect(currentInputs()).toEqual({
      json_var: '{ "a": 1 }',
    })
    expect(newInputs()).toEqual({
      json_var: '{ "a": 1 }',
    })
  })

  it('should show tip when showTip is true', () => {
    render(<InputsFormContent showTip />)
    expect(screen.getByText(/chat.chatFormTip/i)).toBeInTheDocument()
  })

  it('should set initial values from context', () => {
    const contextWithValues = {
      ...baseContext,
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
      ...baseContext,
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
      ...baseContext,
      newConversationInputs: {
        num_var: 0,
      },
    }

    context = contextWithZero

    render(<InputsFormContent />)
    expect(screen.getByRole('spinbutton', { name: 'Number Label' })).toHaveValue(0)
  })
})
