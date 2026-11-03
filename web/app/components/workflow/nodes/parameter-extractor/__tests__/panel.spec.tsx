import type { ParameterExtractorNodeType } from '../types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import Panel from '../panel'
import { ParamType, ReasoningModeType } from '../types'

it('adds a parameter to the node and exposes it as an output after closing the dialog', async () => {
  const user = userEvent.setup()
  const data: ParameterExtractorNodeType = {
    title: 'Parameter Extractor',
    desc: '',
    type: BlockEnum.ParameterExtractor,
    model: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
    query: [],
    reasoning_mode: ReasoningModeType.prompt,
    parameters: [
      { name: 'city', type: ParamType.string, description: 'City name', required: false },
    ],
    instruction: 'Extract city and budget',
    vision: { enabled: false },
  }
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [createCatalogModelFixture({ model: 'gpt-4o', model_properties: { mode: 'chat' } })],
    }),
  ])
  queryClient.setQueryDefaults(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
    { initialData: { data: [] } },
  )
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })

  function NodePanel() {
    const node = useNodes<ParameterExtractorNodeType>().find((node) => node.id === 'extractor')
    if (!node) return null
    return (
      <Panel
        id={node.id}
        data={node.data}
        panelProps={{
          getInputVars: () => [],
          toVarInputs: () => [],
          runInputData: {},
          runInputDataRef: { current: {} },
          setRunInputData: () => {},
          runResult: null,
        }}
      />
    )
  }
  const render = createNuqsTestRenderer((ui) =>
    renderWorkflowFlowComponent(<EventEmitterContextProvider>{ui}</EventEmitterContextProvider>, {
      queryClient,
      nodes: [createNode({ id: 'extractor', data })],
    }),
  )
  render(<NodePanel />)

  await user.click(
    await screen.findByRole('button', {
      name: 'workflowModels.nodes.parameterExtractor.addExtractParameter',
    }),
  )
  await user.type(
    screen.getByRole('textbox', {
      name: 'workflowModels.nodes.parameterExtractor.addExtractParameterContent.name',
    }),
    'budget',
  )
  await user.type(
    screen.getByRole('textbox', {
      name: 'workflowModels.nodes.parameterExtractor.addExtractParameterContent.description',
    }),
    'Budget amount',
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByText('budget')).toBeInTheDocument()
  const outputTrigger = screen.getByRole('button', { name: /outputVars/ })
  await user.click(outputTrigger)
  const outputs = within(document.getElementById(outputTrigger.getAttribute('aria-controls')!)!)
  expect(outputs.getByText('budget')).toBeInTheDocument()
  expect(outputs.getByText('Budget amount')).toBeInTheDocument()
})
