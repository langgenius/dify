import type { VarInInspect } from '@/types/workflow'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarType } from '@/app/components/workflow/types'
import { VarInInspectType } from '@/types/workflow'
import ValueContent from '../value-content'

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
        data-testid="json-editor"
        readOnly={readonly}
        value={schema}
        onChange={(event) => onUpdate(event.target.value)}
      />
    ),
  }),
)

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

describe('ValueContent', () => {
  const createVar = (overrides: Partial<VarInInspect>): VarInInspect =>
    ({
      id: 'var-default',
      name: 'query',
      type: VarInInspectType.node,
      value_type: VarType.string,
      value: '',
      ...overrides,
    }) as VarInInspect

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('should debounce text changes for string variables', async () => {
    const handleValueChange = vi.fn()

    renderWorkflowComponent(
      <ValueContent
        currentVar={createVar({
          id: 'var-1',
          value_type: VarType.string,
          value: 'hello',
        })}
        handleValueChange={handleValueChange}
        isTruncated={false}
      />,
      {
        initialStoreState: {
          fileUploadConfig: {
            workflow_file_upload_limit: 5,
          } as never,
        },
      },
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated' } })

    await waitFor(() => {
      expect(handleValueChange).toHaveBeenCalledWith('var-1', 'updated')
    })
  })

  it('should surface parse errors from invalid json input', async () => {
    renderWorkflowComponent(
      <ValueContent
        currentVar={createVar({
          id: 'var-2',
          name: 'payload',
          value_type: VarType.object,
          value: { foo: 1 },
        })}
        handleValueChange={vi.fn()}
        isTruncated={false}
      />,
      {
        initialStoreState: {
          fileUploadConfig: {
            workflow_file_upload_limit: 5,
          } as never,
        },
      },
    )

    fireEvent.change(screen.getByTestId('json-editor'), { target: { value: '{' } })

    await waitFor(() => {
      expect(screen.getByText(/json/i)).toBeInTheDocument()
    })
  })

  it('should debounce numeric changes', async () => {
    const handleValueChange = vi.fn()

    renderWorkflowComponent(
      <ValueContent
        currentVar={createVar({
          id: 'var-3',
          name: 'count',
          value_type: VarType.number,
          value: 1,
        })}
        handleValueChange={handleValueChange}
        isTruncated={false}
      />,
      {
        initialStoreState: {
          fileUploadConfig: {
            workflow_file_upload_limit: 5,
          } as never,
        },
      },
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '24.5' } })

    await waitFor(() => {
      expect(handleValueChange).toHaveBeenCalledWith('var-3', 24.5)
    })
    expect(handleValueChange).toHaveBeenCalledTimes(1)
  })

  it('keeps invalid numeric drafts local and cancels a pending numeric change', async () => {
    vi.useFakeTimers()
    const handleValueChange = vi.fn()
    const { unmount } = renderWorkflowComponent(
      <ValueContent
        currentVar={createVar({ value_type: VarType.number, value: 1 })}
        handleValueChange={handleValueChange}
        isTruncated={false}
      />,
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '12' } })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '-' } })
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByRole('textbox')).toHaveValue('-')
    expect(handleValueChange).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '-2.5' } })
    act(() => vi.advanceTimersByTime(500))
    expect(handleValueChange).toHaveBeenCalledExactlyOnceWith('var-default', -2.5)
    unmount()
    vi.useRealTimers()
  })

  it('should update boolean values', async () => {
    const handleValueChange = vi.fn()

    renderWorkflowComponent(
      <ValueContent
        currentVar={createVar({
          id: 'var-4',
          name: 'enabled',
          value_type: VarType.boolean,
          value: false,
        })}
        handleValueChange={handleValueChange}
        isTruncated={false}
      />,
      {
        initialStoreState: {
          fileUploadConfig: {
            workflow_file_upload_limit: 5,
          } as never,
        },
      },
    )

    fireEvent.click(screen.getByText('True'))

    await waitFor(() => {
      expect(handleValueChange).toHaveBeenCalledWith('var-4', true)
    })
  })

  it('should not emit changes when the content is truncated', async () => {
    const user = userEvent.setup()
    const handleValueChange = vi.fn()

    renderWorkflowComponent(
      <ValueContent
        currentVar={createVar({
          id: 'var-5',
          value_type: VarType.string,
          value: 'hello',
        })}
        handleValueChange={handleValueChange}
        isTruncated
      />,
      {
        initialStoreState: {
          fileUploadConfig: {
            workflow_file_upload_limit: 5,
          } as never,
        },
      },
    )

    expect(screen.getByRole('textbox')).toBeDisabled()
    await user.type(screen.getByRole('textbox'), 'updated')
    expect(handleValueChange).not.toHaveBeenCalled()
  })

  it('should update boolean array values', async () => {
    const user = userEvent.setup()
    const handleValueChange = vi.fn()

    renderWorkflowComponent(
      <ValueContent
        currentVar={createVar({
          id: 'var-6',
          name: 'flags',
          value_type: VarType.arrayBoolean,
          value: [true, false],
        })}
        handleValueChange={handleValueChange}
        isTruncated={false}
      />,
      {
        initialStoreState: {
          fileUploadConfig: {
            workflow_file_upload_limit: 5,
          } as never,
        },
      },
    )

    await user.click(screen.getAllByRole('button', { name: 'True' })[1]!)

    await waitFor(() => {
      expect(handleValueChange).toHaveBeenCalledWith('var-6', [true, true])
    })
  })

  it('should parse valid json values', async () => {
    const handleValueChange = vi.fn()

    renderWorkflowComponent(
      <ValueContent
        currentVar={createVar({
          id: 'var-7',
          name: 'payload',
          value_type: VarType.object,
          value: { foo: 1 },
        })}
        handleValueChange={handleValueChange}
        isTruncated={false}
      />,
      {
        initialStoreState: {
          fileUploadConfig: {
            workflow_file_upload_limit: 5,
          } as never,
        },
      },
    )

    fireEvent.change(screen.getByTestId('json-editor'), { target: { value: '{"foo":2}' } })

    await waitFor(() => {
      expect(handleValueChange).toHaveBeenCalledWith('var-7', { foo: 2 })
    })
  })

  it('should render LLM environment variables as read-only JSON', async () => {
    const value = { provider: 'openai', name: 'gpt-4o', mode: 'chat' }

    renderWorkflowComponent(
      <ValueContent
        currentVar={createVar({
          id: 'var-llm',
          name: 'for_summarize',
          type: VarInInspectType.environment,
          value_type: 'llm' as VarType,
          value,
        })}
        handleValueChange={vi.fn()}
        isTruncated={false}
      />,
      {
        initialStoreState: {
          fileUploadConfig: {
            workflow_file_upload_limit: 5,
          } as never,
        },
      },
    )

    await waitFor(() => {
      expect(screen.getByTestId('json-editor')).toHaveValue(JSON.stringify(value, null, 2))
    })
    expect(screen.getByTestId('json-editor')).toHaveAttribute('readonly')
  })

  it('should update uploaded single file values and ignore pending uploads', async () => {
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
      {
        initialStoreState: {
          fileUploadConfig: {
            workflow_file_upload_limit: 5,
          } as never,
        },
      },
    )

    fireEvent.click(screen.getByText('file-pending'))

    expect(handleValueChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('file-uploaded'))

    await waitFor(() => {
      expect(handleValueChange).toHaveBeenCalledWith(
        'var-8',
        expect.objectContaining({ upload_file_id: 'file-1' }),
      )
    })
  })

  it('should update uploaded file arrays and react to resize observer changes', async () => {
    const handleValueChange = vi.fn()
    const observe = vi.fn()
    const disconnect = vi.fn()
    const originalResizeObserver = globalThis.ResizeObserver
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLDivElement.prototype,
      'clientHeight',
    )

    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 120,
    })

    class MockResizeObserver {
      callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }

      observe = (target: Element) => {
        observe(target)
        this.callback(
          [
            {
              borderBoxSize: [{ inlineSize: 300, blockSize: 20 }],
            } as unknown as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        )
      }

      disconnect = disconnect
    }

    vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver)

    const { unmount } = renderWorkflowComponent(
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
      {
        initialStoreState: {
          fileUploadConfig: {
            workflow_file_upload_limit: 5,
          } as never,
        },
      },
    )

    fireEvent.click(screen.getByText('file-array-uploaded'))

    await waitFor(() => {
      expect(handleValueChange).toHaveBeenCalledWith(
        'var-9',
        expect.arrayContaining([
          expect.objectContaining({ upload_file_id: 'file-1' }),
          expect.objectContaining({ upload_file_id: 'file-2' }),
        ]),
      )
    })

    expect(observe).toHaveBeenCalled()
    expect(document.querySelector('[style="height: 100px;"]')).toBeInTheDocument()

    if (originalClientHeight)
      Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', originalClientHeight)
    else delete (HTMLDivElement.prototype as { clientHeight?: number }).clientHeight

    if (originalResizeObserver) vi.stubGlobal('ResizeObserver', originalResizeObserver)
    else vi.unstubAllGlobals()

    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
