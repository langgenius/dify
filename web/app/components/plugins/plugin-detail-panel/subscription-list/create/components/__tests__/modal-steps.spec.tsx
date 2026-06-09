import type { FormRefObject } from '@/app/components/base/form/types'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { ApiKeyStep } from '../../hooks/use-common-modal-state'
import {
  ConfigurationStepContent,
  MultiSteps,
  VerifyStepContent,
} from '../modal-steps'

const mockBaseForm = vi.fn()
vi.mock('@/app/components/base/form/components/base', () => ({
  BaseForm: ({
    formSchemas,
    onChange,
  }: {
    formSchemas: Array<{ name: string }>
    onChange?: () => void
  }) => {
    mockBaseForm(formSchemas)
    return (
      <div data-testid="base-form">
        {formSchemas.map(schema => (
          <button key={schema.name} data-testid={`field-${schema.name}`} onClick={onChange}>
            {schema.name}
          </button>
        ))}
      </div>
    )
  },
}))

vi.mock('../../../log-viewer', () => ({
  default: ({ logs }: { logs: Array<{ id: string, message: string }> }) => (
    <div data-testid="log-viewer">
      {logs.map(log => <span key={log.id}>{log.message}</span>)}
    </div>
  ),
}))

const subscriptionBuilder: TriggerSubscriptionBuilder = {
  id: 'builder-1',
  name: 'builder',
  provider: 'provider-a',
  credential_type: TriggerCredentialTypeEnum.ApiKey,
  credentials: {},
  endpoint: 'https://example.com/callback',
  parameters: {},
  properties: {},
  workflows_in_use: 0,
}

const formRef = { current: null } as React.RefObject<FormRefObject | null>

describe('modal-steps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the api key multi step indicator', () => {
    render(<MultiSteps currentStep={ApiKeyStep.Verify} />)

    expect(screen.getByText('pluginTrigger.modal.steps.verify')).toBeInTheDocument()
    expect(screen.getByText('pluginTrigger.modal.steps.configuration')).toBeInTheDocument()
  })

  it('should render verify step content and forward change events', () => {
    const onChange = vi.fn()

    render(
      <VerifyStepContent
        apiKeyCredentialsSchema={[{ name: 'api_key', type: FormTypeEnum.textInput }]}
        apiKeyCredentialsFormRef={formRef}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByTestId('field-api_key'))

    expect(onChange).toHaveBeenCalled()
  })

  it('should render manual configuration content with logs', () => {
    const onManualPropertiesChange = vi.fn()

    render(
      <ConfigurationStepContent
        createType={SupportedCreationMethods.MANUAL}
        subscriptionBuilder={subscriptionBuilder}
        subscriptionFormRef={formRef}
        autoCommonParametersSchema={[]}
        autoCommonParametersFormRef={formRef}
        manualPropertiesSchema={[{ name: 'webhook_url', type: FormTypeEnum.textInput }]}
        manualPropertiesFormRef={formRef}
        onManualPropertiesChange={onManualPropertiesChange}
        logs={[{ id: '1', message: 'log-entry', timestamp: 'now', level: 'info', response: { status_code: 200 } } as never]}
        pluginId="plugin-id"
        pluginName="Plugin A"
        provider="provider-a"
      />,
    )

    fireEvent.click(screen.getByTestId('field-webhook_url'))

    expect(onManualPropertiesChange).toHaveBeenCalled()
    expect(screen.getByTestId('log-viewer')).toHaveTextContent('log-entry')
  })
})
