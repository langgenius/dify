import type { InputForm } from '@/app/components/base/chat/chat/type'
import type { ChatConfig } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { render, screen } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { ChatWithHistoryContext, useChatWithHistoryContext } from '../../context'
import InputsFormContent from '../content'

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/',
}))
vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: () => null,
}))

const createFile = (name: string): FileEntity => ({
  id: name,
  name,
  type: 'text/plain',
  size: 100,
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  uploadedId: name,
})

const selectedInputs = {
  single: createFile('selected.txt'),
  multiple: [createFile('selected-list.txt')],
}
const defaultInputs = {
  single: createFile('default.txt'),
  multiple: [createFile('default-list.txt')],
}
const forms: InputForm[] = [
  {
    variable: 'single',
    label: 'File',
    type: InputVarType.singleFile,
    required: false,
    hide: false,
    allowed_file_types: ['document'],
    allowed_file_upload_methods: [TransferMethod.local_file],
  },
  {
    variable: 'multiple',
    label: 'Files',
    type: InputVarType.multiFiles,
    required: false,
    hide: false,
    allowed_file_types: ['document'],
    allowed_file_upload_methods: [TransferMethod.local_file],
    max_length: 3,
  },
]

type FormProps = {
  conversationId?: string
  clearChatList?: boolean
  inputs?: Record<string, unknown>
}

function Form({ conversationId = '', clearChatList = false, inputs = {} }: FormProps) {
  const defaults = useChatWithHistoryContext()
  return (
    <ChatWithHistoryContext.Provider
      value={{
        ...defaults,
        appParams: {} as ChatConfig,
        inputsForms: forms,
        currentConversationId: conversationId,
        currentConversationInputs: inputs,
        newConversationInputs: inputs,
        newConversationInputsRef: { current: inputs },
        clearChatList,
      }}
    >
      <InputsFormContent />
    </ChatWithHistoryContext.Provider>
  )
}

describe('chat file input reset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe.each(['', 'existing-conversation'])(
    'starting from conversation "%s"',
    (conversationId) => {
      it.each([false, true])(
        'should reset single and multiple files with defaults=%s',
        (hasDefaults) => {
          const resetInputs = hasDefaults ? defaultInputs : { single: null, multiple: null }
          const { rerender } = render(
            <Form conversationId={conversationId} inputs={selectedInputs} />,
          )
          expect(screen.getByText(selectedInputs.single.name)).toBeInTheDocument()
          expect(screen.getByText(selectedInputs.multiple[0]!.name)).toBeInTheDocument()

          rerender(<Form clearChatList inputs={resetInputs} />)
          expect(screen.queryByText(selectedInputs.single.name)).not.toBeInTheDocument()
          expect(screen.queryByText(selectedInputs.multiple[0]!.name)).not.toBeInTheDocument()
          rerender(<Form inputs={resetInputs} />)

          expect(screen.queryByText(selectedInputs.single.name)).not.toBeInTheDocument()
          expect(screen.queryByText(selectedInputs.multiple[0]!.name)).not.toBeInTheDocument()
          if (hasDefaults) {
            expect(screen.getByText(defaultInputs.single.name)).toBeInTheDocument()
            expect(screen.getByText(defaultInputs.multiple[0]!.name)).toBeInTheDocument()
          } else {
            expect(screen.queryByText(defaultInputs.single.name)).not.toBeInTheDocument()
            expect(screen.queryByText(defaultInputs.multiple[0]!.name)).not.toBeInTheDocument()
          }
        },
      )
    },
  )

  it('should show the destination files when switching conversations', () => {
    const { rerender } = render(<Form conversationId="first" inputs={selectedInputs} />)

    rerender(<Form conversationId="second" inputs={defaultInputs} />)

    expect(screen.getByText(defaultInputs.single.name)).toBeInTheDocument()
    expect(screen.getByText(defaultInputs.multiple[0]!.name)).toBeInTheDocument()
    expect(screen.queryByText(selectedInputs.single.name)).not.toBeInTheDocument()
    expect(screen.queryByText(selectedInputs.multiple[0]!.name)).not.toBeInTheDocument()
  })
})
