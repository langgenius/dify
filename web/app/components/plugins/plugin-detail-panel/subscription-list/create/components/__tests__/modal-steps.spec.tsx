/* eslint-disable ts/no-explicit-any */
import type { SchemaItem } from '../modal-steps'
import type { TriggerLogEntity, TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { ApiKeyStep } from '../../hooks/use-common-modal-state'
import {
  AutoParametersForm,
  ConfigurationStepContent,
  ManualPropertiesSection,
  MultiSteps,

  SubscriptionForm,
  VerifyStepContent,
} from '../modal-steps'

const baseFormCalls: Array<Record<string, unknown>> = []

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/form/components/base', async () => {
  const React = await import('react')

  return {
    BaseForm: React.forwardRef((props: any, ref) => {
      baseFormCalls.push(props)
      React.useImperativeHandle(ref, () => ({}))
      return (
        <div data-testid="base-form">
          {props.formSchemas.map((schema: { name: string, type: string }) => (
            <div
              key={schema.name}
              data-testid={`schema-${schema.name}`}
              data-type={schema.type}
            />
          ))}
        </div>
      )
    }),
  }
})

vi.mock('@/app/components/plugins/plugin-detail-panel/subscription-list/log-viewer', () => ({
  default: ({ logs }: { logs: Array<{ id: string, message: string }> }) => (
    <div data-testid="log-viewer">{logs.map(log => <span key={log.id}>{log.message}</span>)}</div>
  ),
}))

describe('modal steps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    baseFormCalls.length = 0
  })

  it('should highlight the active status step', () => {
    const { rerender } = render(<MultiSteps currentStep={ApiKeyStep.Verify} />)

    expect(screen.getByText('modal.steps.verify')).toHaveClass('text-state-accent-solid')
    expect(screen.getByText('modal.steps.configuration')).toHaveClass('text-text-tertiary')

    rerender(<MultiSteps currentStep={ApiKeyStep.Configuration} />)

    expect(screen.getByText('modal.steps.configuration')).toHaveClass('text-state-accent-solid')
  })

  it('should render verify form only when credentials schema exists', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <VerifyStepContent
        apiKeyCredentialsSchema={[]}
        apiKeyCredentialsFormRef={{ current: null }}
        onChange={onChange}
      />,
    )

    expect(screen.queryByTestId('base-form')).not.toBeInTheDocument()

    rerender(
      <VerifyStepContent
        apiKeyCredentialsSchema={[{ name: 'api_key', type: FormTypeEnum.secretInput }]}
        apiKeyCredentialsFormRef={{ current: null }}
        onChange={onChange}
      />,
    )

    expect(screen.getByTestId('schema-api_key')).toBeInTheDocument()
  })

  it('should build subscription form with callback url defaults', () => {
    render(
      <SubscriptionForm
        subscriptionFormRef={{ current: null }}
        endpoint="https://example.com/callback"
      />,
    )

    expect(baseFormCalls[0]?.formSchemas).toEqual([
      expect.objectContaining({
        name: 'subscription_name',
        type: FormTypeEnum.textInput,
        required: true,
      }),
      expect.objectContaining({
        name: 'callback_url',
        default: 'https://example.com/callback',
        disabled: true,
        showCopy: true,
      }),
    ])
  })

  it('should normalize auto parameter schema types', () => {
    const schemas = [
      { name: 'count', type: 'integer' },
      { name: 'enabled', type: 'boolean' },
      { name: 'remote', type: FormTypeEnum.dynamicSelect },
      { name: 'fallback', type: 'mystery' },
    ] as unknown as SchemaItem[]

    render(
      <AutoParametersForm
        schemas={schemas}
        formRef={{ current: null }}
        pluginId="plugin-id"
        provider="provider-id"
        credentialId="credential-id"
      />,
    )

    const formSchemas = baseFormCalls[0]?.formSchemas as Array<Record<string, unknown>>
    expect(formSchemas).toEqual([
      expect.objectContaining({ name: 'count', type: FormTypeEnum.textNumber }),
      expect.objectContaining({
        name: 'enabled',
        type: FormTypeEnum.boolean,
        fieldClassName: 'flex items-center justify-between',
      }),
      expect.objectContaining({
        name: 'remote',
        type: FormTypeEnum.dynamicSelect,
        dynamicSelectParams: {
          plugin_id: 'plugin-id',
          provider: 'provider-id',
          action: 'provider',
          parameter: 'remote',
          credential_id: 'credential-id',
        },
      }),
      expect.objectContaining({ name: 'fallback', type: FormTypeEnum.textInput }),
    ])
  })

  it('should render manual properties section with logs', () => {
    render(
      <ManualPropertiesSection
        schemas={[{ name: 'webhook_url', type: FormTypeEnum.textInput, description: 'Webhook URL' }]}
        formRef={{ current: null }}
        onChange={vi.fn()}
        logs={[{ id: 'log-1', message: 'Listening' }] as unknown as TriggerLogEntity[]}
        pluginName="Webhook Plugin"
      />,
    )

    expect(screen.getByTestId('schema-webhook_url')).toBeInTheDocument()
    expect(screen.getByText('modal.manual.logs.loading')).toBeInTheDocument()
    expect(screen.getByTestId('log-viewer')).toHaveTextContent('Listening')
  })

  it('should switch between auto and manual configuration content', () => {
    const commonProps = {
      subscriptionBuilder: { id: 'builder-1', endpoint: 'https://example.com/callback' } as unknown as TriggerSubscriptionBuilder,
      subscriptionFormRef: { current: null },
      autoCommonParametersSchema: [{ name: 'repo', type: FormTypeEnum.textInput }],
      autoCommonParametersFormRef: { current: null },
      manualPropertiesSchema: [{ name: 'webhook_url', type: FormTypeEnum.textInput }],
      manualPropertiesFormRef: { current: null },
      onManualPropertiesChange: vi.fn(),
      logs: [{ id: 'log-1', message: 'Waiting' }] as unknown as TriggerLogEntity[],
      pluginId: 'plugin-id',
      pluginName: 'Plugin',
      provider: 'provider-id',
    }

    const { rerender } = render(
      <ConfigurationStepContent
        {...commonProps}
        createType={SupportedCreationMethods.APIKEY}
      />,
    )

    expect(screen.getByTestId('schema-repo')).toBeInTheDocument()
    expect(screen.queryByTestId('schema-webhook_url')).not.toBeInTheDocument()

    rerender(
      <ConfigurationStepContent
        {...commonProps}
        createType={SupportedCreationMethods.MANUAL}
      />,
    )

    expect(screen.getByTestId('schema-webhook_url')).toBeInTheDocument()
    expect(screen.queryByTestId('schema-repo')).not.toBeInTheDocument()
  })
})
