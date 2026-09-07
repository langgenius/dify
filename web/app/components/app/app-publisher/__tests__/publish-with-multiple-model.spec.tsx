import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import PublishWithMultipleModel from '../publish-with-multiple-model'

const mockUseProviderContext = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('../../header/account-setting/model-provider-page/model-icon', () => ({
  default: ({ modelName }: { modelName: string }) => <span>{modelName}</span>,
}))

describe('PublishWithMultipleModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProviderContext.mockReturnValue({
      textGenerationModelList: [
        {
          provider: 'openai',
          models: [
            {
              model: 'gpt-4o',
              label: {
                en_US: 'GPT-4o',
              },
            },
          ],
        },
      ],
    })
  })

  it('should disable the trigger when no valid model configuration is available', () => {
    render(
      <PublishWithMultipleModel
        multipleModelConfigs={[
          {
            id: 'config-1',
            provider: 'anthropic',
            model: 'claude-3',
            parameters: {},
          },
        ]}
        onSelect={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: /(?:^|\.)operation\.applyConfig(?=$|:)/ }),
    ).toBeDisabled()
    expect(screen.queryByText(/(?:^|\.)publishAs(?=$|:)/)).not.toBeInTheDocument()
  })

  it('should disable the trigger when publishing is unavailable', () => {
    render(
      <PublishWithMultipleModel
        disabled
        multipleModelConfigs={[
          {
            id: 'config-1',
            provider: 'openai',
            model: 'gpt-4o',
            parameters: {},
          },
        ]}
        onSelect={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: /(?:^|\.)operation\.applyConfig(?=$|:)/ }),
    ).toBeDisabled()
  })

  it('should open matching model options and call onSelect', () => {
    const handleSelect = vi.fn()
    const modelConfig = {
      id: 'config-1',
      provider: 'openai',
      model: 'gpt-4o',
      parameters: { temperature: 0.7 },
    }

    render(
      <PublishWithMultipleModel multipleModelConfigs={[modelConfig]} onSelect={handleSelect} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /(?:^|\.)operation\.applyConfig(?=$|:)/ }))

    expect(screen.getByText(/(?:^|\.)publishAs(?=$|:)/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('GPT-4o'))

    expect(handleSelect).toHaveBeenCalledWith(expect.objectContaining(modelConfig))
  })
})
