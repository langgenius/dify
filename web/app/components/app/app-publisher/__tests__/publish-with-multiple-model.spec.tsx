import { zAvailableModelListResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import PublishWithMultipleModel from '../publish-with-multiple-model'

function render(ui: React.ReactElement) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: 'llm' } },
    }).queryKey,
    zAvailableModelListResponse.parse({
      data: [
        {
          provider: 'openai',
          tenant_id: 'workspace-1',
          status: 'active',
          label: { en_US: 'OpenAI' },
          models: [
            {
              model: 'gpt-4o',
              label: { en_US: 'GPT-4o' },
              model_type: 'llm',
              status: 'active',
              fetch_from: 'predefined-model',
              model_properties: {},
            },
          ],
        },
      ],
    }),
  )
  return renderWithConsoleQuery(ui, { queryClient })
}

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

describe('PublishWithMultipleModel', () => {
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

  it('should open matching model options and call onSelect', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.applyConfig(?=$|:)/ }))

    expect(screen.getByText(/(?:^|\.)publishAs(?=$|:)/)).toBeInTheDocument()

    await user.click(screen.getByText('GPT-4o'))

    expect(handleSelect).toHaveBeenCalledWith(expect.objectContaining(modelConfig))
  })
})
