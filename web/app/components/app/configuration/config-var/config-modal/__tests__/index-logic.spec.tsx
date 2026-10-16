import type { ComponentProps } from 'react'
import type { InputVar } from '@/app/components/workflow/types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { toast } from '@/app/components/app/configuration/toast'
import { InputVarType } from '@/app/components/workflow/types'
import DebugConfigurationContext from '@/context/debug-configuration'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import ConfigModal from '../index'

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
}))

const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')
let latestFormProps: ComponentProps<typeof import('../form-fields').default> | null = null
vi.mock('../form-fields', () => ({
  default: (props: ComponentProps<typeof import('../form-fields').default>) => {
    latestFormProps = props
    return (
      <div data-testid="config-form-fields">
        <div data-testid="payload-type">{String(props.tempPayload.type)}</div>
        <div data-testid="payload-hide">{String(props.tempPayload.hide)}</div>
        <div data-testid="payload-label">{String(props.tempPayload.label ?? '')}</div>
        <div data-testid="payload-schema">{String(props.tempPayload.json_schema ?? '')}</div>
        <div data-testid="payload-default">{String(props.tempPayload.default ?? '')}</div>
        <input data-testid="invalid-key-blur" onBlur={props.onVarKeyBlur} />
        <input data-testid="valid-key-blur" onBlur={props.onVarKeyBlur} />
        <input data-testid="invalid-name-change" onChange={props.onVarNameChange} />
        <button
          type="button"
          data-testid="valid-json-change"
          onClick={() => props.onJSONSchemaChange('{\n  "foo": "bar"\n}')}
        >
          valid-json-change
        </button>
        <button
          type="button"
          data-testid="empty-json-change"
          onClick={() => props.onJSONSchemaChange('   ')}
        >
          empty-json-change
        </button>
        <button
          type="button"
          data-testid="invalid-json-change"
          onClick={() => props.onJSONSchemaChange('{invalid-json}')}
        >
          invalid-json-change
        </button>
        <button
          type="button"
          data-testid="type-change"
          onClick={() => props.onTypeChange({ value: InputVarType.singleFile, name: 'File' })}
        >
          type-change
        </button>
        <button
          type="button"
          data-testid="file-payload-change"
          onClick={() => {
            const payload = {
              ...props.tempPayload,
              default: 'file-default',
              max_length: props.tempPayload.max_length ?? 1,
              allowed_file_types: props.tempPayload.allowed_file_types ?? [],
              allowed_file_upload_methods: props.tempPayload.allowed_file_upload_methods ?? [],
            }
            props.onFilePayloadChange(payload)
          }}
        >
          file-payload-change
        </button>
      </div>
    )
  },
}))

const createPayload = (overrides: Partial<InputVar> = {}): InputVar => ({
  type: InputVarType.textInput,
  label: '',
  variable: 'question',
  required: false,
  hide: false,
  options: [],
  default: 'hello',
  max_length: 32,
  ...overrides,
})

const renderConfigModal = (payload: InputVar = createPayload()) => {
  const queryClient = createConsoleQueryClient()
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode: 'chat' as const }))
  return renderWithConsoleQuery(
    <DebugConfigurationContext.Provider
      value={createDebugConfigurationFixture({
        mode: 'chat' as const,
        dataSets: [],
        modelConfig: createModelConfigFixture({ model_id: 'model-1' }),
      })}
    >
      <ConfigModal isCreate isShow payload={payload} onClose={vi.fn()} onConfirm={vi.fn()} />
    </DebugConfigurationContext.Provider>,
    { queryClient },
  )
}

describe('ConfigModal logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestFormProps = null
  })

  it('should surface validation errors from invalid variable name callbacks', async () => {
    renderConfigModal()

    fireEvent.blur(screen.getByTestId('invalid-key-blur'), { target: { value: 'invalid key' } })
    fireEvent.change(screen.getByTestId('invalid-name-change'), {
      target: { value: 'invalid-key!', selectionStart: 0, selectionEnd: 0 },
    })

    await waitFor(() => {
      expect(toastErrorSpy).toHaveBeenCalledTimes(2)
    })
  })

  it('should keep the existing label when blur runs on a payload that already has one', async () => {
    renderConfigModal(createPayload({ label: 'Existing label' }))

    fireEvent.blur(screen.getByTestId('valid-key-blur'), { target: { value: 'auto_label' } })

    await waitFor(() => {
      expect(screen.getByTestId('payload-label')).toHaveTextContent('Existing label')
    })
  })

  it('should derive payload fields from mocked form-field callbacks', async () => {
    renderConfigModal(createPayload({ hide: true }))

    fireEvent.blur(screen.getByTestId('valid-key-blur'), { target: { value: 'auto_label' } })
    await waitFor(() => {
      expect(screen.getByTestId('payload-label')).toHaveTextContent('auto_label')
    })

    fireEvent.click(screen.getByTestId('valid-json-change'))
    await waitFor(() => {
      expect(screen.getByTestId('payload-schema').textContent).toMatch(/"foo": "bar"/)
    })

    fireEvent.click(screen.getByTestId('invalid-json-change'))
    expect(screen.getByTestId('payload-schema')).toHaveTextContent('{invalid-json}')

    fireEvent.click(screen.getByTestId('empty-json-change'))
    await waitFor(() => {
      expect(screen.getByTestId('payload-schema')).toHaveTextContent('')
    })

    fireEvent.click(screen.getByTestId('type-change'))
    await waitFor(() => {
      expect(screen.getByTestId('payload-type')).toHaveTextContent(InputVarType.singleFile)
      expect(screen.getByTestId('payload-hide')).toHaveTextContent('false')
    })

    fireEvent.click(screen.getByTestId('file-payload-change'))
    await waitFor(() => {
      expect(screen.getByTestId('payload-default')).toHaveTextContent('file-default')
    })

    expect(latestFormProps?.modelId).toBe('model-1')
  })

  it('should pass object json_schema to the editor as JSON text', () => {
    const jsonSchema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['id', 'name'],
    }

    renderConfigModal(
      createPayload({
        type: InputVarType.jsonObject,
        label: 'dsmworksheet',
        variable: 'dsmworksheet',
        json_schema: jsonSchema as InputVar['json_schema'],
      }),
    )

    expect(latestFormProps?.jsonSchemaStr).toBe(JSON.stringify(jsonSchema, null, 2))
  })
})
