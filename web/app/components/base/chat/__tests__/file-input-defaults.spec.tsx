import type { InputForm } from '../chat/type'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { noop } from 'es-toolkit/function'
import { useEffect, useRef, useState } from 'react'
import { InputVarType } from '@/app/components/workflow/types'
import { AppSourceType } from '@/service/share'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createChatConfigFixture, createChatFileFixture } from '@/test/fixtures/chat'
import { ChatWithHistoryContext, useChatWithHistoryContext } from '../chat-with-history/context'
import HistoryInputsForm from '../chat-with-history/inputs-form'
import { useChat } from '../chat/hooks'
import { getProcessedInputs } from '../chat/utils'
import { EmbeddedChatbotContext, useEmbeddedChatbotContext } from '../embedded-chatbot/context'
import EmbeddedInputsForm from '../embedded-chatbot/inputs-form'

vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/' }))
vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: () => null,
}))

const singleFile = createChatFileFixture({ name: 'default.txt' })
const listFile = createChatFileFixture({
  id: 'list-file',
  name: 'list-default.txt',
  uploadedId: 'list-upload',
})
const singleForm: InputForm = {
  variable: 'file',
  label: 'File',
  type: InputVarType.singleFile,
  required: false,
  hide: false,
  default: singleFile,
  allowed_file_types: ['document'],
  allowed_file_upload_methods: ['local_file'],
}
const forms: InputForm[] = [
  singleForm,
  {
    ...singleForm,
    variable: 'files',
    label: 'Files',
    type: InputVarType.multiFiles,
    default: [listFile],
  },
]
const defaultInputs = { file: singleFile, files: [listFile] }
const selectedFile = createChatFileFixture({ name: 'selected.txt', uploadedId: 'selected-upload' })
const selectedListFile = createChatFileFixture({
  name: 'selected-list.txt',
  uploadedId: 'selected-list-upload',
})
const selectedInputs = { file: selectedFile, files: [selectedListFile] }

type ConversationProps = {
  surface: 'published' | 'embedded'
  initialInputs?: Record<string, unknown>
  initializeDefaults?: boolean
  appSourceType?: AppSourceType
  onSubmit?: (body: unknown) => void
}

function Conversation({
  surface,
  initialInputs = {},
  initializeDefaults = false,
  appSourceType = AppSourceType.webApp,
  onSubmit = noop,
}: ConversationProps) {
  const historyDefaults = useChatWithHistoryContext()
  const embeddedDefaults = useEmbeddedChatbotContext()
  const [inputs, setInputs] = useState(initialInputs)
  const inputsRef = useRef(inputs)
  const [collapsed, setCollapsed] = useState(false)
  const [clearChatList, setClearChatList] = useState(false)
  useChat(undefined, undefined, undefined, undefined, clearChatList, setClearChatList)
  useEffect(() => {
    if (!initializeDefaults) return
    inputsRef.current = defaultInputs
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Match the chat hooks: defaults arrive after the first form render.
    setInputs(defaultInputs)
  }, [initializeDefaults])

  const value = {
    appParams: createChatConfigFixture(),
    inputsForms: forms,
    currentConversationId: '',
    appSourceType,
    clearChatList,
    currentConversationInputs: inputs,
    newConversationInputs: inputs,
    newConversationInputsRef: inputsRef,
    setCurrentConversationInputs: noop,
    handleNewConversationInputsChange: (next: Record<string, unknown>) => {
      inputsRef.current = next
      setInputs(next)
    },
    handleStartChat: (callback?: () => void) => callback?.(),
  }
  const actions = (
    <>
      <button
        onClick={() => {
          if (appSourceType !== AppSourceType.tryApp) {
            inputsRef.current = defaultInputs
            setInputs(defaultInputs)
          }
          setClearChatList(true)
        }}
      >
        Reset chat
      </button>
      <button
        onClick={() =>
          onSubmit(JSON.parse(JSON.stringify({ inputs: getProcessedInputs(inputs, forms) })))
        }
      >
        Submit inputs
      </button>
    </>
  )

  return surface === 'published' ? (
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider component.
    <ChatWithHistoryContext.Provider value={{ ...historyDefaults, ...value }}>
      {actions}
      <HistoryInputsForm collapsed={collapsed} setCollapsed={setCollapsed} />
    </ChatWithHistoryContext.Provider>
  ) : (
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider component.
    <EmbeddedChatbotContext.Provider value={{ ...embeddedDefaults, ...value }}>
      {actions}
      <EmbeddedInputsForm collapsed={collapsed} setCollapsed={setCollapsed} />
    </EmbeddedChatbotContext.Provider>
  )
}

describe.each(['published', 'embedded'] as const)('%s chat file inputs', (surface) => {
  it('shows single-file and file-list defaults when the parent initializes inputs after mount', () => {
    render(<Conversation surface={surface} initializeDefaults />)

    expect(screen.getByText(singleFile.name)).toBeInTheDocument()
    expect(screen.getByText(listFile.name)).toBeInTheDocument()
  })

  it('keeps optional files cleared after reopening and submits explicit empty values', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Conversation surface={surface} initializeDefaults onSubmit={onSubmit} />)

    for (const file of [singleFile, listFile])
      await user.click(screen.getByRole('button', { name: `common.operation.remove ${file.name}` }))
    await user.click(screen.getByRole('button', { name: 'share.chat.startChat' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))

    expect(screen.queryByText(singleFile.name)).not.toBeInTheDocument()
    expect(screen.queryByText(listFile.name)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit inputs' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ inputs: { file: '', files: [] } })
  })

  it('restores visible defaults and submitted inputs after Start, Edit and Reset', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Conversation surface={surface} initialInputs={selectedInputs} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'share.chat.startChat' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(screen.getByText(selectedFile.name)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset chat' }))

    expect(screen.getByText(singleFile.name)).toBeInTheDocument()
    expect(screen.getByText(listFile.name)).toBeInTheDocument()
    expect(screen.queryByText(selectedFile.name)).not.toBeInTheDocument()
    expect(screen.queryByText(selectedListFile.name)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit inputs' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      inputs: {
        file: expect.objectContaining({ upload_file_id: singleFile.uploadedId }),
        files: [expect.objectContaining({ upload_file_id: listFile.uploadedId })],
      },
    })
  })
})

it('keeps the selected files when Try App only clears the conversation', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  render(
    <Conversation
      surface="embedded"
      appSourceType={AppSourceType.tryApp}
      initialInputs={selectedInputs}
      onSubmit={onSubmit}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Reset chat' }))

  expect(screen.getByText(selectedFile.name)).toBeInTheDocument()
  expect(screen.getByText(selectedListFile.name)).toBeInTheDocument()
  expect(screen.queryByText(singleFile.name)).not.toBeInTheDocument()
  expect(screen.queryByText(listFile.name)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Submit inputs' }))
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
    inputs: {
      file: expect.objectContaining({ upload_file_id: selectedFile.uploadedId }),
      files: [expect.objectContaining({ upload_file_id: selectedListFile.uploadedId })],
    },
  })
})
