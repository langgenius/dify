import type { ModelAndParameter } from '../../configuration/debug/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublishWithMultipleModel from '../publish-with-multiple-model'

let mockTextGenerationModelList: Array<{
  provider: string
  models: Array<{
    model: string
    label: Record<string, string>
  }>
}>

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({
    children,
    open,
  }: {
    children: React.ReactNode
    open: boolean
  }) => <div data-testid="portal" data-open={String(open)}>{children}</div>,
  PortalToFollowElemTrigger: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => <div onClick={onClick}>{children}</div>,
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => <div data-testid="portal-content">{children}</div>,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    textGenerationModelList: mockTextGenerationModelList,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-icon', () => ({
  default: ({ modelName }: { modelName: string }) => <div data-testid={`model-icon-${modelName}`}>{modelName}</div>,
}))

const validConfig: ModelAndParameter = {
  id: 'config-1',
  model: 'gpt-4o',
  provider: 'openai',
  parameters: {},
}

describe('PublishWithMultipleModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTextGenerationModelList = [{
      provider: 'openai',
      models: [{
        model: 'gpt-4o',
        label: {
          en_US: 'GPT-4o',
        },
      }],
    }]
  })

  it('should disable the button when no valid model configuration matches the provider context', async () => {
    const user = userEvent.setup()

    render(
      <PublishWithMultipleModel
        multipleModelConfigs={[{ ...validConfig, provider: 'missing-provider' }]}
        onSelect={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'appDebug.operation.applyConfig' })

    expect(trigger).toBeDisabled()

    await user.click(trigger)

    expect(screen.getByTestId('portal')).toHaveAttribute('data-open', 'false')
  })

  it('should open the model list and forward the selected configuration', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <PublishWithMultipleModel
        multipleModelConfigs={[validConfig]}
        onSelect={onSelect}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'appDebug.operation.applyConfig' })

    expect(trigger).not.toBeDisabled()

    await user.click(trigger)

    expect(screen.getByTestId('portal')).toHaveAttribute('data-open', 'true')
    expect(screen.getByText('appDebug.publishAs')).toBeInTheDocument()
    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
    expect(screen.getByTestId('model-icon-gpt-4o')).toBeInTheDocument()

    await user.click(screen.getByText('GPT-4o'))

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining(validConfig))
    expect(screen.getByTestId('portal')).toHaveAttribute('data-open', 'false')
  })
})
