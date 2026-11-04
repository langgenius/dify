import type { ChatWithHistoryContextValue } from '../../context'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { fileUpload } from '@/app/components/base/file-uploader/utils'
import { InputVarType } from '@/app/components/workflow/types'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createChatConfigFixture, createChatFileFixture } from '@/test/fixtures/chat'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { TransferMethod } from '@/types/app'
import { ChatWithHistoryContext, useChatWithHistoryContext } from '../../context'
import InputsFormContent from '../content'

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({}),
  usePathname: () => '/chat',
}))

vi.mock('@/app/components/base/file-uploader/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/file-uploader/utils')>()),
  fileUpload: vi.fn(),
}))

const uploadedFile = createChatFileFixture({
  name: 'report.pdf',
  type: 'application/pdf',
  uploadedId: 'server-file-1',
})
type Options = Partial<
  Pick<
    ChatWithHistoryContextValue,
    'currentConversationId' | 'currentConversationInputs' | 'newConversationInputs' | 'inputsForms'
  >
>
function setup(options: Options = {}, showTip = false) {
  function Caller() {
    const defaults = useChatWithHistoryContext()
    const [currentInputs, setCurrentInputs] = useState(
      options.currentConversationInputs ?? { text_var: 'current-value' },
    )
    const [newInputs, setNewInputs] = useState(
      options.newConversationInputs ?? { text_var: 'new-value' },
    )
    const newInputsRef = useRef(newInputs)
    return (
      <ChatWithHistoryContext.Provider
        value={{
          ...defaults,
          ...options,
          appParams: createChatConfigFixture({
            system_parameters: createFileUploadConfigFixture(),
          }),
          inputsForms: options.inputsForms ?? [
            {
              variable: 'text_var',
              type: InputVarType.textInput,
              label: 'Text Label',
              required: true,
            },
          ],
          currentConversationId: options.currentConversationId ?? '123',
          currentConversationInputs: currentInputs,
          newConversationInputs: newInputs,
          newConversationInputsRef: newInputsRef,
          setCurrentConversationInputs: setCurrentInputs,
          handleNewConversationInputsChange: (value) => {
            newInputsRef.current = value
            setNewInputs(value)
          },
        }}
      >
        <InputsFormContent showTip={showTip} />
        <output aria-label="Current conversation inputs">{JSON.stringify(currentInputs)}</output>
        <output aria-label="New conversation inputs">{JSON.stringify(newInputs)}</output>
      </ChatWithHistoryContext.Provider>
    )
  }
  return renderWithConsoleQuery(<Caller />)
}
const currentInputs = () =>
  JSON.parse(screen.getByLabelText('Current conversation inputs').textContent!)
const newInputs = () => JSON.parse(screen.getByLabelText('New conversation inputs').textContent!)

beforeEach(() => {
  vi.mocked(fileUpload)
    .mockReset()
    .mockImplementation(({ file, onSuccessCallback }) => {
      onSuccessCallback({
        id: 'server-file-1',
        name: file.name,
        mime_type: file.type,
        extension: 'pdf',
        size: file.size,
        created_at: 0,
        created_by: 'user-1',
        source_url: '',
        preview_url: null,
      })
    })
})

it('renders only visible inputs and includes the footer tip when requested', () => {
  setup(
    {
      inputsForms: [
        { variable: 'text_var', type: InputVarType.textInput, label: 'Text Label', required: true },
        { variable: 'hidden_var', type: InputVarType.textInput, label: 'Hidden', hide: true },
      ],
    },
    true,
  )
  expect(screen.getByRole('textbox', { name: 'Text Label' })).toBeVisible()
  expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  expect(screen.getByText('share.chat.chatFormTip')).toBeVisible()
})

it.each([
  { currentConversationId: '123', value: 'current-value' },
  { currentConversationId: '', value: 'new-value' },
])(
  'edits the active input source and preserves both conversation drafts (%s)',
  async ({ currentConversationId, value }) => {
    const user = userEvent.setup()
    setup({ currentConversationId })
    const input = screen.getByRole('textbox', { name: 'Text Label' })
    expect(input).toHaveValue(value)
    expect(screen.queryByText('share.chat.chatFormTip')).not.toBeInTheDocument()
    await user.clear(input)
    await user.type(input, 'updated')
    expect(input).toHaveValue('updated')
    expect(currentInputs()).toEqual({ text_var: 'updated' })
    expect(newInputs()).toEqual({ text_var: 'updated' })
  },
)

it('updates numeric and paragraph fields without losing the other input', async () => {
  const user = userEvent.setup()
  setup({
    inputsForms: [
      { variable: 'num', type: InputVarType.number, label: 'Num' },
      { variable: 'para', type: InputVarType.paragraph, label: 'Para' },
    ],
    currentConversationInputs: { num: 0 },
    newConversationInputs: { num: 0 },
  })
  const number = screen.getByRole('spinbutton', { name: 'Num' })
  expect(number).toHaveValue(0)
  await user.clear(number)
  await user.type(number, '123')
  await user.type(screen.getByRole('textbox', { name: 'Para' }), 'hello')
  expect(number).toHaveValue(123)
  expect(screen.getByRole('textbox', { name: 'Para' })).toHaveValue('hello')
  expect(currentInputs()).toEqual({ num: '123', para: 'hello' })
  expect(newInputs()).toEqual({ num: '123', para: 'hello' })
})

it('updates boolean inputs through the real checkbox', async () => {
  const user = userEvent.setup()
  setup({ inputsForms: [{ variable: 'bool', type: InputVarType.checkbox, label: 'Bool' }] })
  const checkbox = screen.getByRole('checkbox', { name: /Bool/ })
  await user.click(checkbox)
  expect(checkbox).toBeChecked()
  expect(currentInputs()).toEqual({ text_var: 'current-value', bool: true })
  expect(newInputs()).toEqual({ text_var: 'new-value', bool: true })
})

it('replaces the select default with the chosen value', async () => {
  const user = userEvent.setup()
  setup({
    inputsForms: [
      {
        variable: 'sel',
        type: InputVarType.select,
        label: 'Sel',
        options: ['A', 'B'],
        default: 'B',
      },
    ],
    currentConversationInputs: {},
  })
  const select = screen.getByRole('combobox', { name: 'Sel' })
  expect(select).toHaveTextContent('B')
  await user.click(select)
  await user.click(screen.getByRole('option', { name: 'A' }))
  expect(select).toHaveTextContent('A')
  expect(currentInputs()).toEqual({ sel: 'A' })
  expect(newInputs()).toEqual({ text_var: 'new-value', sel: 'A' })
})

it('preserves a saved selection after its option is removed', () => {
  setup({
    inputsForms: [{ variable: 'sel', type: InputVarType.select, label: 'Sel', options: ['A'] }],
    currentConversationInputs: { sel: 'existing' },
  })
  expect(screen.getByRole('combobox', { name: 'Sel' })).toHaveTextContent('existing')
})

it('edits JSON through the real code-editor wrapper', async () => {
  const user = userEvent.setup()
  setup({
    inputsForms: [
      { variable: 'json', type: InputVarType.jsonObject, label: 'Json', json_schema: '{ "a": 1 }' },
    ],
    currentConversationInputs: {},
  })
  expect(screen.getByText('{ "a": 1 }')).toBeVisible()
  // Monaco itself is an external editor boundary supplied by vitest.setup.ts.
  const editor = screen.getByTestId('monaco-editor')
  await user.click(editor)
  await user.paste('{"a":2}')
  expect(editor).toHaveValue('{"a":2}')
  expect(currentInputs()).toEqual({ json: '{"a":2}' })
  expect(newInputs()).toEqual({ text_var: 'new-value', json: '{"a":2}' })
})

const fileForm = (type: typeof InputVarType.singleFile | typeof InputVarType.multiFiles) => ({
  variable: 'attachment',
  type,
  label: 'Attachment',
  max_length: 3,
  allowed_file_types: ['document'],
  allowed_file_extensions: [],
  allowed_file_upload_methods: [TransferMethod.local_file],
})

it('shows an existing single-file value', () => {
  setup({
    inputsForms: [fileForm(InputVarType.singleFile)],
    currentConversationInputs: { attachment: uploadedFile },
  })
  expect(screen.getByText('report.pdf')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'common.fileUploader.uploadFromComputer' }),
  ).toBeDisabled()
})

it.each([InputVarType.singleFile, InputVarType.multiFiles])(
  'uploads %s through the real file owner and stores its value shape',
  async (type) => {
    const user = userEvent.setup()
    const { container } = setup({
      inputsForms: [fileForm(type)],
      currentConversationInputs: {},
      newConversationInputs: {},
    })
    expect(screen.queryByText('report.pdf')).not.toBeInTheDocument()
    // Native file inputs have no useful role/name in the current uploader.
    await user.upload(
      container.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(['report'], 'report.pdf', { type: 'application/pdf' }),
    )
    const file = expect.objectContaining({
      name: 'report.pdf',
      uploadedId: 'server-file-1',
      progress: 100,
      transferMethod: TransferMethod.local_file,
    })
    const attachment = type === InputVarType.singleFile ? file : [file]
    await waitFor(() => expect(currentInputs()).toEqual({ attachment }))
    expect(newInputs()).toEqual({ attachment })
    expect(screen.getByText('report.pdf')).toBeVisible()
  },
)
