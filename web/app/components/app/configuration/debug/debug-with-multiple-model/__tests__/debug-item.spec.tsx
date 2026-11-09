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
import { DebugWithMultipleModelContext } from '../context'
import DebugItem from '../debug-item'

// Chat and completion own generation; this suite owns the model list actions.
vi.mock('../chat-item', () => ({
  default: ({ modelAndParameter }: { modelAndParameter: ModelAndParameter }) => (
    <div data-testid="chat-item" data-model-id={modelAndParameter.id}>
      ChatItem
    </div>
  ),
}))

vi.mock('../text-generation-item', () => ({
  default: ({ modelAndParameter }: { modelAndParameter: ModelAndParameter }) => (
    <div data-testid="text-generation-item" data-model-id={modelAndParameter.id}>
      TextGenerationItem
    </div>
  ),
}))

const model = (id: string, name = 'gpt-4'): ModelAndParameter => ({
  id,
  model: name,
  provider: 'openai',
  parameters: { temperature: 0.7 },
})
function renderItems({
  models = [model('first'), model('second', 'gpt-3.5-turbo')],
  mode = 'chat',
  catalog = [
    { model: 'gpt-4', status: ModelStatusEnum.active },
    { model: 'gpt-3.5-turbo', status: ModelStatusEnum.active },
  ],
}: {
  models?: ModelAndParameter[]
  mode?: 'chat' | 'agent-chat' | 'completion'
  catalog?: { model: string; status: ModelStatusEnum }[]
} = {}) {
  function Caller() {
    const [configs, setConfigs] = useState(models)
    const [single, setSingle] = useState<ModelAndParameter>()
    return (
      <DebugConfigurationContext.Provider value={createDebugConfigurationFixture({ mode })}>
        <DebugWithMultipleModelContext.Provider
          value={{
            multipleModelConfigs: configs,
            onMultipleModelConfigsChange: (_, next) => setConfigs(next),
            onDebugWithMultipleModelChange: setSingle,
            onOpenLog: () => {},
          }}
        >
          <output aria-label="Model configurations">{JSON.stringify(configs)}</output>
          {single ? (
            <output aria-label="Single model">{JSON.stringify(single)}</output>
          ) : (
            configs.map((config) => (
              <section key={config.id} aria-label={config.id}>
                <DebugItem modelAndParameter={config} />
              </section>
            ))
          )}
        </DebugWithMultipleModelContext.Provider>
      </DebugConfigurationContext.Provider>
    )
  }
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({ models: catalog.map((item) => createCatalogModelFixture(item)) }),
  ])
  for (const config of models) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.queryKey({
        input: { params: { provider: config.provider }, query: { model: config.model } },
      }),
      { data: [] },
    )
  }
  return renderWithConsoleQuery(<Caller />, { queryClient })
}
const readModels = (): ModelAndParameter[] =>
  JSON.parse(screen.getByLabelText('Model configurations').textContent!)

it.each(['chat', 'agent-chat', 'completion'] as const)(
  'renders the active %s model runner',
  (mode) => {
    renderItems({ models: [model('first')], mode })
    expect(
      screen.getByTestId(mode === 'completion' ? 'text-generation-item' : 'chat-item'),
    ).toBeInTheDocument()
  },
)
it.each([
  { name: 'disabled', catalog: [{ model: 'gpt-4', status: ModelStatusEnum.disabled }] },
  { name: 'missing', catalog: [] },
])('does not run a $name model', ({ catalog }) => {
  renderItems({ models: [model('first')], catalog })
  expect(screen.queryByTestId('chat-item')).not.toBeInTheDocument()
})
it('duplicates beside the selected model with a fresh identity and stops at four', async () => {
  const user = userEvent.setup()
  const models = [model('first'), model('second'), model('third')]
  renderItems({ models })
  await user.click(
    within(screen.getByRole('region', { name: 'second' })).getByRole('button', {
      name: 'common.operation.more',
    }),
  )
  await user.click(screen.getByRole('menuitem', { name: 'appDebug.duplicateModel' }))
  const configs = readModels()
  expect(configs).toEqual([
    models[0],
    models[1],
    { ...models[1], id: expect.any(String) },
    models[2],
  ])
  expect(models.map((m) => m.id)).not.toContain(configs[2]!.id)
  expect(screen.getAllByRole('region')).toHaveLength(4)
  await user.click(
    within(screen.getByRole('region', { name: 'second' })).getByRole('button', {
      name: 'common.operation.more',
    }),
  )
  expect(
    screen.queryByRole('menuitem', { name: 'appDebug.duplicateModel' }),
  ).not.toBeInTheDocument()
})
it('removes the selected model and hides removal at the two-model minimum', async () => {
  const user = userEvent.setup()
  const models = [model('first'), model('second'), model('third')]
  renderItems({ models })
  await user.click(
    within(screen.getByRole('region', { name: 'second' })).getByRole('button', {
      name: 'common.operation.more',
    }),
  )
  await user.click(screen.getByRole('menuitem', { name: 'common.operation.remove' }))
  expect(readModels()).toEqual([models[0], models[2]])
  expect(screen.queryByRole('region', { name: 'second' })).not.toBeInTheDocument()
  await user.click(
    within(screen.getByRole('region', { name: 'third' })).getByRole('button', {
      name: 'common.operation.more',
    }),
  )
  expect(
    screen.queryByRole('menuitem', { name: 'common.operation.remove' }),
  ).not.toBeInTheDocument()
})
it('selects the complete configuration for single-model debugging', async () => {
  const user = userEvent.setup()
  renderItems()
  await user.click(
    within(screen.getByRole('region', { name: 'second' })).getByRole('button', {
      name: 'common.operation.more',
    }),
  )
  await user.click(screen.getByRole('menuitem', { name: 'appDebug.debugAsSingleModel' }))
  expect(JSON.parse(screen.getByLabelText('Single model').textContent!)).toEqual(
    model('second', 'gpt-3.5-turbo'),
  )
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
})
it.each([
  { provider: '', model: 'gpt-4' },
  { provider: 'openai', model: '' },
])('hides single debugging for incomplete configuration %j', async (fields) => {
  const user = userEvent.setup()
  renderItems({ models: [{ ...model('first'), ...fields }] })
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  expect(
    screen.queryByRole('menuitem', { name: 'appDebug.debugAsSingleModel' }),
  ).not.toBeInTheDocument()
})
