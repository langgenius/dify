import type { VarInInspect } from '@/types/workflow'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarType } from '@/app/components/workflow/types'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { VarInInspectType } from '@/types/workflow'
import ValueContent from '../value-content'

// Rich JSON editing is independently tested; this shim keeps ValueContent's value contract visible.
vi.mock(
  '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/schema-editor',
  () => ({
    default: ({
      schema,
      onUpdate,
      readonly,
    }: {
      schema: string
      onUpdate: (value: string) => void
      readonly?: boolean
    }) => (
      <textarea
        aria-label="JSON value"
        readOnly={readonly}
        value={schema}
        onChange={(event) => onUpdate(event.target.value)}
      />
    ),
  }),
)

// Upload mechanics are independently tested; this boundary supplies completed and pending file states.
vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({
    onChange,
  }: {
    onChange: (files: Array<Record<string, unknown>>) => void
  }) => (
    <div>
      <button onClick={() => onChange([{ uploadedId: '' }])}>file-pending</button>
      <button onClick={() => onChange([{ uploadedId: 'file-1', name: 'report.pdf' }])}>
        file-uploaded
      </button>
      <button
        onClick={() =>
          onChange([
            { uploadedId: 'file-1', name: 'a.pdf' },
            { uploadedId: 'file-2', name: 'b.pdf' },
          ])
        }
      >
        file-array-uploaded
      </button>
    </div>
  ),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: '' }),
}))

const createVar = (overrides: Partial<VarInInspect> = {}): VarInInspect => ({
  id: 'var-default',
  name: 'query',
  type: VarInInspectType.node,
  value_type: VarType.string,
  value: '',
  description: '',
  selector: ['node-1', 'query'],
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: null,
  ...overrides,
})

const renderValueContent = (
  currentVar: VarInInspect,
  handleValueChange = vi.fn(),
  isTruncated = false,
) =>
  renderWorkflowComponent(
    <ValueContent
      currentVar={currentVar}
      handleValueChange={handleValueChange}
      isTruncated={isTruncated}
    />,
  )

const setupDebounceTest = () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  // React Testing Library detects this Jest-shaped bridge before draining its async wrapper.
  vi.stubGlobal('jest', { advanceTimersByTime: vi.advanceTimersByTime })
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

describe('ValueContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('coalesces intermediate string edits into the latest debounced value', async () => {
    const user = setupDebounceTest()
    const handleValueChange = vi.fn()
    renderValueContent(createVar({ id: 'var-1', value: 'hello' }), handleValueChange)
    const input = screen.getByRole('textbox')

    await user.clear(input)
    await user.type(input, 'draft')
    await user.clear(input)
    await user.type(input, 'updated')

    await vi.advanceTimersByTimeAsync(499)
    expect(handleValueChange).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(handleValueChange).toHaveBeenCalledExactlyOnceWith('var-1', 'updated')
  })

  it('does not save invalid JSON and recovers after a valid edit', async () => {
    const user = setupDebounceTest()
    const handleValueChange = vi.fn()
    renderValueContent(
      createVar({
        id: 'var-2',
        name: 'payload',
        value_type: VarType.object,
        value: { foo: 1 },
      }),
      handleValueChange,
    )
    const editor = screen.getByRole('textbox', { name: 'JSON value' })

    await user.clear(editor)
    await user.paste('[')
    expect(screen.getByText(/json/i)).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(500)
    expect(handleValueChange).not.toHaveBeenCalled()

    await user.clear(editor)
    await user.paste('{"foo":2}')
    expect(screen.queryByText(/json/i)).not.toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(500)
    expect(handleValueChange).toHaveBeenCalledExactlyOnceWith('var-2', { foo: 2 })
  })

  it('cancels a pending numeric value while the draft is invalid, then saves recovery', async () => {
    const user = setupDebounceTest()
    const handleValueChange = vi.fn()
    renderValueContent(
      createVar({ name: 'count', value_type: VarType.number, value: 1 }),
      handleValueChange,
    )
    const input = screen.getByRole('textbox')

    await user.clear(input)
    await user.type(input, '12')
    await user.clear(input)
    await user.type(input, '-')
    expect(input).toHaveValue('-')
    await vi.advanceTimersByTimeAsync(500)
    expect(handleValueChange).not.toHaveBeenCalled()

    await user.type(input, '2.5')
    await vi.advanceTimersByTimeAsync(500)
    expect(handleValueChange).toHaveBeenCalledExactlyOnceWith('var-default', -2.5)
  })

  it('updates boolean values', async () => {
    const user = userEvent.setup()
    const handleValueChange = vi.fn()
    renderValueContent(
      createVar({ id: 'var-4', name: 'enabled', value_type: VarType.boolean, value: false }),
      handleValueChange,
    )

    await user.click(screen.getByRole('button', { name: 'True' }))
    await waitFor(() => {
      expect(handleValueChange).toHaveBeenCalledExactlyOnceWith('var-4', true)
    })
  })

  it('does not emit changes when the content is truncated', async () => {
    const user = userEvent.setup()
    const handleValueChange = vi.fn()
    renderValueContent(createVar({ id: 'var-5', value: 'hello' }), handleValueChange, true)

    expect(screen.getByRole('textbox')).toBeDisabled()
    await user.type(screen.getByRole('textbox'), 'updated')
    expect(handleValueChange).not.toHaveBeenCalled()
  })

  it('updates the selected boolean array value', async () => {
    const user = userEvent.setup()
    const handleValueChange = vi.fn()
    renderValueContent(
      createVar({
        id: 'var-6',
        name: 'flags',
        value_type: VarType.arrayBoolean,
        value: [true, false],
      }),
      handleValueChange,
    )

    await user.click(screen.getAllByRole('button', { name: 'True' })[1]!)
    await waitFor(() => {
      expect(handleValueChange).toHaveBeenCalledExactlyOnceWith('var-6', [true, true])
    })
  })

  it('renders LLM environment variables as read-only JSON', () => {
    const value = { provider: 'openai', name: 'gpt-4o', mode: 'chat' }
    renderValueContent(
      createVar({
        id: 'var-llm',
        name: 'for_summarize',
        type: VarInInspectType.environment,
        value_type: 'llm',
        value,
      }),
    )

    expect(screen.getByRole('textbox', { name: 'JSON value' })).toHaveValue(
      JSON.stringify(value, null, 2),
    )
    expect(screen.getByRole('textbox', { name: 'JSON value' })).toHaveAttribute('readonly')
  })

  it('ignores pending single-file uploads and saves completed files', async () => {
    const user = setupDebounceTest()
    const handleValueChange = vi.fn()
    renderWorkflowComponent(
      <ValueContent
        currentVar={createVar({
          id: 'var-8',
          name: 'files',
          value_type: VarType.file,
          value: null,
        })}
        handleValueChange={handleValueChange}
        isTruncated={false}
      />,
      { initialStoreState: { fileUploadConfig: createFileUploadConfigFixture() } },
    )

    await user.click(screen.getByRole('button', { name: 'file-pending' }))
    await vi.advanceTimersByTimeAsync(500)
    expect(handleValueChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'file-uploaded' }))
    await vi.advanceTimersByTimeAsync(500)
    expect(handleValueChange).toHaveBeenCalledExactlyOnceWith(
      'var-8',
      expect.objectContaining({ upload_file_id: 'file-1' }),
    )
  })

  it('converts every completed file in an uploaded array', async () => {
    const user = userEvent.setup()
    const handleValueChange = vi.fn()
    renderWorkflowComponent(
      <ValueContent
        currentVar={createVar({
          id: 'var-9',
          name: 'files',
          type: VarInInspectType.system,
          value_type: VarType.arrayFile,
          value: [],
        })}
        handleValueChange={handleValueChange}
        isTruncated={false}
      />,
      { initialStoreState: { fileUploadConfig: createFileUploadConfigFixture() } },
    )

    await user.click(screen.getByRole('button', { name: 'file-array-uploaded' }))
    await waitFor(() => {
      expect(handleValueChange).toHaveBeenCalledExactlyOnceWith('var-9', [
        expect.objectContaining({ upload_file_id: 'file-1' }),
        expect.objectContaining({ upload_file_id: 'file-2' }),
      ])
    })
  })
})
