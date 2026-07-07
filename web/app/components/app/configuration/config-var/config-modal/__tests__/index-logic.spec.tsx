/* eslint-disable ts/no-explicit-any */
import type { InputVar } from '@/app/components/workflow/types'
import type { App, AppSSO } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useStore } from '@/app/components/app/store'
import { InputVarType } from '@/app/components/workflow/types'
import DebugConfigurationContext from '@/context/debug-configuration'
import { AppModeEnum } from '@/types/app'
import ConfigModal from '../index'

const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')
let latestFormProps: Record<string, any> | null = null

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../form-fields', () => ({
  default: (props: Record<string, any>) => {
    latestFormProps = props
    return (
      <div data-testid="config-form-fields">
        <div data-testid="payload-type">{String(props.tempPayload.type)}</div>
        <div data-testid="payload-hide">{String(props.tempPayload.hide)}</div>
        <div data-testid="payload-label">{String(props.tempPayload.label ?? '')}</div>
        <div data-testid="payload-schema">{String(props.tempPayload.json_schema ?? '')}</div>
        <div data-testid="payload-default">{String(props.tempPayload.default ?? '')}</div>
        <button data-testid="invalid-key-blur" onClick={() => props.onVarKeyBlur({ target: { value: 'invalid key' } })}>invalid-key-blur</button>
        <button data-testid="valid-key-blur" onClick={() => props.onVarKeyBlur({ target: { value: 'auto_label' } })}>valid-key-blur</button>
        <button
          data-testid="invalid-name-change"
          onClick={() => props.onVarNameChange({
            target: {
              value: 'invalid-key!',
              selectionStart: 0,
              selectionEnd: 0,
              setSelectionRange: vi.fn(),
            },
          })}
        >
          invalid-name-change
        </button>
        <button data-testid="valid-json-change" onClick={() => props.onJSONSchemaChange('{\n  "foo": "bar"\n}')}>valid-json-change</button>
        <button data-testid="empty-json-change" onClick={() => props.onJSONSchemaChange('   ')}>empty-json-change</button>
        <button data-testid="invalid-json-change" onClick={() => props.onJSONSchemaChange('{invalid-json}')}>invalid-json-change</button>
        <button data-testid="type-change" onClick={() => props.onTypeChange({ value: InputVarType.singleFile })}>type-change</button>
        <button data-testid="file-payload-change" onClick={() => props.onFilePayloadChange({ ...props.tempPayload, default: 'file-default' })}>file-payload-change</button>
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

const renderConfigModal = (payload: InputVar = createPayload()) => render(
  <DebugConfigurationContext.Provider value={{
    mode: AppModeEnum.CHAT,
    dataSets: [],
    modelConfig: { model_id: 'model-1' },
  } as any}
  >
    <ConfigModal
      isCreate
      isShow
      payload={payload}
      onClose={vi.fn()}
      onConfirm={vi.fn()}
    />
  </DebugConfigurationContext.Provider>,
)

describe('ConfigModal logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestFormProps = null
    useStore.setState({
      appDetail: {
        mode: AppModeEnum.CHAT,
      } as App & Partial<AppSSO>,
    })
  })

  it('should surface validation errors from invalid variable name callbacks', async () => {
    renderConfigModal()

    fireEvent.click(screen.getByTestId('invalid-key-blur'))
    fireEvent.click(screen.getByTestId('invalid-name-change'))

    await waitFor(() => {
      expect(toastErrorSpy).toHaveBeenCalledTimes(2)
    })
  })

  it('should keep the existing label when blur runs on a payload that already has one', async () => {
    renderConfigModal(createPayload({ label: 'Existing label' }))

    fireEvent.click(screen.getByTestId('valid-key-blur'))

    await waitFor(() => {
      expect(screen.getByTestId('payload-label')).toHaveTextContent('Existing label')
    })
  })

  it('should derive payload fields from mocked form-field callbacks', async () => {
    renderConfigModal(createPayload({ hide: true }))

    fireEvent.click(screen.getByTestId('valid-key-blur'))
    await waitFor(() => {
      expect(screen.getByTestId('payload-label')).toHaveTextContent('auto_label')
    })

    fireEvent.click(screen.getByTestId('valid-json-change'))
    await waitFor(() => {
      expect(screen.getByTestId('payload-schema')).toHaveTextContent(/"foo": "bar"/)
    })

    fireEvent.click(screen.getByTestId('invalid-json-change'))
    expect(screen.getByTestId('payload-schema')).toHaveTextContent(/"foo": "bar"/)

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
})
