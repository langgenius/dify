import type { VarInInspect } from '@/types/workflow'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarType } from '@/app/components/workflow/types'
import { VarInInspectType } from '@/types/workflow'
import ValueContent from '../value-content'

vi.mock('@/app/components/base/file-uploader/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/base/file-uploader/utils')>()
  return {
    ...actual,
    getProcessedFiles: (files: unknown[]) => files,
  }
})

vi.mock('@/app/components/workflow/nodes/llm/components/json-schema-config-modal/schema-editor', () => ({
  default: ({ schema, onUpdate }: { schema: string, onUpdate: (value: string) => void }) => (
    <textarea data-testid="json-editor" value={schema} onChange={event => onUpdate(event.target.value)} />
  ),
}))

vi.mock('../value-content-sections', () => ({
  TextEditorSection: ({
    value,
    onTextChange,
  }: {
    value: string
    onTextChange: (value: string) => void
  }) => <textarea aria-label="value-text-editor" value={value ?? ''} onChange={event => onTextChange(event.target.value)} />,
  BoolArraySection: ({
    onChange,
  }: {
    onChange: (value: boolean[]) => void
  }) => <button onClick={() => onChange([true, true])}>bool-array-editor</button>,
  JsonEditorSection: ({
    json,
    onChange,
  }: {
    json: string
    onChange: (value: string) => void
  }) => <textarea data-testid="json-editor" value={json} onChange={event => onChange(event.target.value)} />,
  FileEditorSection: ({
    onChange,
  }: {
    onChange: (files: Array<Record<string, unknown>>) => void
  }) => (
    <div>
      <button onClick={() => onChange([{ upload_file_id: '' }])}>file-pending</button>
      <button onClick={() => onChange([{ upload_file_id: 'file-1', name: 'report.pdf' }])}>file-uploaded</button>
      <button onClick={() => onChange([
        { upload_file_id: 'file-1', name: 'a.pdf' },
        { upload_file_id: 'file-2', name: 'b.pdf' },
      ])}
      >
        file-array-uploaded
      </button>
    </div>
  ),
  ErrorMessages: ({
    parseError,
    validationError,
  }: {
    parseError: Error | null
    validationError: string
  }) => (
    <div>
      {parseError && <div>{parseError.message}</div>}
      {validationError && <div>{validationError}</div>}
    </div>
  ),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: '' }),
}))

describe('ValueContent', () => {
  const createVar = (overrides: Partial<VarInInspect>): VarInInspect => ({
    id: 'var-default',
    name: 'query',
    type: VarInInspectType.node,
    value_type: VarType.string,
    value: '',
    ...overrides,
  } as VarInInspect)

  beforeEach(() => {
    vi.clearAllMocks()
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

    fireEvent.change(screen.getByLabelText('value-text-editor'), { target: { value: 'updated' } })

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

    fireEvent.change(screen.getByLabelText('value-text-editor'), { target: { value: '24.5' } })

    await waitFor(() => {
      expect(handleValueChange).toHaveBeenCalledWith('var-3', 24.5)
    })
    expect(handleValueChange).toHaveBeenCalledTimes(1)
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

    fireEvent.change(screen.getByLabelText('value-text-editor'), { target: { value: 'updated' } })

    await waitFor(() => {
      expect(handleValueChange).not.toHaveBeenCalled()
    })
  })

  it('should update boolean array values', async () => {
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

    fireEvent.click(screen.getByText('bool-array-editor'))

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

    await waitFor(() => {
      expect(handleValueChange).not.toHaveBeenCalled()
    })

    fireEvent.click(screen.getByText('file-uploaded'))

    await waitFor(() => {
      expect(handleValueChange).toHaveBeenCalledWith('var-8', expect.objectContaining({ upload_file_id: 'file-1' }))
    })
  })

  it('should update uploaded file arrays and react to resize observer changes', async () => {
    const handleValueChange = vi.fn()
    const observe = vi.fn()
    const disconnect = vi.fn()
    const originalResizeObserver = globalThis.ResizeObserver
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, 'clientHeight')

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
        this.callback([{
          borderBoxSize: [{ inlineSize: 20 }],
        } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
      }

      disconnect = disconnect
    }

    vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver)

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
      expect(handleValueChange).toHaveBeenCalledWith('var-9', expect.arrayContaining([
        expect.objectContaining({ upload_file_id: 'file-1' }),
        expect.objectContaining({ upload_file_id: 'file-2' }),
      ]))
    })

    expect(observe).toHaveBeenCalled()
    expect(document.querySelector('[style="height: 100px;"]')).toBeInTheDocument()

    if (originalClientHeight)
      Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', originalClientHeight)
    else
      delete (HTMLDivElement.prototype as { clientHeight?: number }).clientHeight

    if (originalResizeObserver)
      vi.stubGlobal('ResizeObserver', originalResizeObserver)
    else
      vi.unstubAllGlobals()

    expect(disconnect).not.toHaveBeenCalled()
  })
})
