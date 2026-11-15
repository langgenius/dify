import type { ModelAndParameter } from '../../types'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ModelStatusEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import DebugConfigurationContext from '@/context/debug-configuration'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDebugConfigurationFixture } from '@/test/fixtures/debug-configuration'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { DebugWithMultipleModelContext } from '../context'
import ModelParameterTrigger from '../model-parameter-trigger'

const createModelAndParameter = (
  overrides: Partial<ModelAndParameter> = {},
): ModelAndParameter => ({
  id: 'model-1',
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: { temperature: 0.7 },
  ...overrides,
})

const renderComponent = ({
  models = [createModelAndParameter()],
  index = 0,
  status = ModelStatusEnum.active,
  missingModel = false,
}: {
  models?: ModelAndParameter[]
  index?: number
  status?: ModelStatusEnum
  missingModel?: boolean
} = {}) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        ...(!missingModel
          ? [
              createCatalogModelFixture({
                model: 'gpt-3.5-turbo',
                label: { en_US: 'GPT-3.5 Turbo' },
                model_properties: { mode: 'chat' },
                status,
              }),
            ]
          : []),
        createCatalogModelFixture({ model_properties: { mode: 'chat' } }),
      ],
    }),
  ])
  queryClient.setQueryDefaults(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
    {
      initialData: {
        data: [
          {
            name: 'temperature',
            label: { en_US: 'Temperature' },
            type: 'float',
            default: 0.7,
            min: 0,
            max: 2,
          },
        ],
      },
    },
  )
  const onMultipleModelConfigsChange = vi.fn()
  const onDebugWithMultipleModelChange = vi.fn()
  function Owner() {
    const [configs, setConfigs] = useState(models)
    return (
      <DebugConfigurationContext.Provider value={createDebugConfigurationFixture()}>
        <DebugWithMultipleModelContext.Provider
          value={{
            multipleModelConfigs: configs,
            onOpenLog: vi.fn(),
            onDebugWithMultipleModelChange,
            onMultipleModelConfigsChange: (multiple, nextConfigs) => {
              onMultipleModelConfigsChange(multiple, nextConfigs)
              setConfigs(nextConfigs)
            },
          }}
        >
          <ModelParameterTrigger modelAndParameter={configs[index]!} />
        </DebugWithMultipleModelContext.Provider>
      </DebugConfigurationContext.Provider>
    )
  }
  const render = createNuqsTestRenderer((ui) => renderWithConsoleQuery(ui, { queryClient }))
  return { ...render(<Owner />), onMultipleModelConfigsChange, onDebugWithMultipleModelChange }
}

describe('ModelParameterTrigger', () => {
  it('changes the selected model without changing the other comparison models', async () => {
    const user = userEvent.setup()
    const models = ['model-1', 'model-2', 'model-3'].map((id) => createModelAndParameter({ id }))
    const { onMultipleModelConfigsChange } = renderComponent({ models, index: 1 })

    await user.click(screen.getByRole('button', { name: /^GPT-3.5 Turbo/ }))
    const settings = within(screen.getByRole('dialog', { name: /modelProvider.modelSettings/ }))
    await user.click(settings.getByRole('button', { name: /^GPT-3.5 Turbo/ }))
    const picker = within(
      await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
    )
    await user.click(picker.getByRole('button', { name: /^GPT-4/ }))

    expect(onMultipleModelConfigsChange).toHaveBeenLastCalledWith(true, [
      models[0],
      { ...models[1], model: 'gpt-4', provider: 'openai' },
      models[2],
    ])
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: /^GPT-4/ })).toBeInTheDocument()
  })

  it('updates parameters while preserving the model and other settings', async () => {
    const user = userEvent.setup()
    const model = createModelAndParameter({ parameters: { temperature: 0.7, max_tokens: 256 } })
    const { onMultipleModelConfigsChange } = renderComponent({ models: [model] })

    await user.click(screen.getByRole('button', { name: /^GPT-3.5 Turbo/ }))
    const temperature = screen.getByRole('spinbutton', { name: 'Temperature' })
    await user.clear(temperature)
    await user.type(temperature, '0.8')
    await user.tab()

    expect(onMultipleModelConfigsChange).toHaveBeenLastCalledWith(true, [
      { ...model, parameters: { temperature: 0.8, max_tokens: 256 } },
    ])
  })

  it('continues debugging with only the chosen comparison model', async () => {
    const user = userEvent.setup()
    const model = createModelAndParameter()
    const { onDebugWithMultipleModelChange } = renderComponent({ models: [model] })

    await user.click(screen.getByRole('button', { name: /^GPT-3.5 Turbo/ }))
    await user.click(screen.getByRole('button', { name: 'appDebug.debugAsSingleModel' }))

    expect(onDebugWithMultipleModelChange).toHaveBeenCalledWith(model)
  })

  it('offers model selection when no model is configured', () => {
    renderComponent({ models: [createModelAndParameter({ provider: '', model: '' })] })
    expect(
      screen.getByRole('button', { name: 'modelProvider.modelProvider.selectModel' }),
    ).toBeInTheDocument()
  })

  it.each([
    { missingModel: true, status: ModelStatusEnum.active, tip: 'incompatibleTip' },
    { missingModel: false, status: ModelStatusEnum.noConfigure, tip: 'configureRequired' },
    { missingModel: false, status: ModelStatusEnum.disabled, tip: 'disabled' },
  ])('explains the $tip state of the configured model', async ({ missingModel, status, tip }) => {
    const user = userEvent.setup()
    renderComponent({ missingModel, status })
    const message = `modelProvider.modelProvider.selector.${tip}`
    const trigger = screen.getByRole('button', { name: new RegExp(message) })
    expect(trigger.textContent).toContain(missingModel ? 'gpt-3.5-turbo' : 'GPT-3.5 Turbo')
    await user.hover(trigger)
    expect(
      await screen.findByText(
        (content, element) => content === message && !!element && !trigger.contains(element),
      ),
    ).toBeInTheDocument()
  })
})
