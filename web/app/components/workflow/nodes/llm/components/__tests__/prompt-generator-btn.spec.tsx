import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import PromptGeneratorBtn from '../prompt-generator-btn'

const { generateRule } = vi.hoisted(() => ({ generateRule: vi.fn() }))

vi.mock('@/service/debug', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/debug')>()),
  generateRule: (...args: unknown[]) => generateRule(...args),
}))

const renderGenerator = createNuqsTestRenderer((ui) => {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({
          model: 'gpt-4o-mini',
          label: { en_US: 'GPT-4o mini' },
          model_properties: { mode: 'chat' },
        }),
      ],
    }),
  ])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: 'llm' } },
    }),
    { data: createDefaultModelFixture({ model: 'gpt-4o-mini' }) },
  )
  queryClient.setQueryDefaults(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
    { initialData: { data: [] } },
  )
  queryClient.setQueryData(
    consoleQuery.instructionGenerate.template.post.queryOptions({
      input: { body: { type: 'prompt' } },
    }).queryKey,
    { data: 'Describe the prompt improvement' },
  )

  const start = createStartNode({
    id: 'start',
    data: {
      title: 'Inputs',
      variables: [
        {
          variable: 'query',
          label: 'Query',
          type: InputVarType.textInput,
          required: true,
        },
      ],
    },
  })
  const llm = createNode({
    id: 'node-1',
    data: { type: BlockEnum.LLM, title: 'Prompt writer' },
  })

  return renderWorkflowFlowComponent(
    <EventEmitterContextProvider>{ui}</EventEmitterContextProvider>,
    {
      queryClient,
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      nodes: [start, llm],
      edges: [
        createEdge({
          source: start.id,
          target: llm.id,
          data: { sourceType: BlockEnum.Start, targetType: BlockEnum.LLM },
        }),
      ],
    },
  )
})

describe('PromptGeneratorBtn', () => {
  it('applies generated text and closes the generator', async () => {
    sessionStorage.clear()
    localStorage.removeItem('auto-gen-model')
    generateRule.mockResolvedValue({ modified: 'Generated prompt' })
    const user = userEvent.setup()

    function ControlledPrompt() {
      const [prompt, setPrompt] = useState('Original prompt')
      return (
        <>
          <PromptGeneratorBtn
            nodeId="node-1"
            editorId="system"
            currentPrompt={prompt}
            onGenerated={setPrompt}
          />
          <output aria-label="Saved prompt">{prompt}</output>
        </>
      )
    }

    renderGenerator(<ControlledPrompt />)

    await user.click(screen.getByRole('button', { name: 'appDebug.operation.automatic' }))
    const dialog = await screen.findByRole('dialog', { name: 'appGeneration.generate.title' })
    expect(within(dialog).getByRole('button', { name: /GPT-4o mini/ })).toBeInTheDocument()
    await replacePromptEditorText(
      within(dialog).getByRole('textbox', { name: 'appGeneration.generate.instruction' }),
      'Make the prompt concise',
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'appGeneration.generate.generate' }),
    )

    expect(await within(dialog).findByText('Generated prompt')).toBeInTheDocument()
    expect(generateRule).toHaveBeenCalledExactlyOnceWith({
      flow_id: 'app-1',
      node_id: 'node-1',
      current: 'Original prompt',
      instruction: 'Make the prompt concise',
      ideal_output: '',
      model_config: expect.objectContaining({
        name: 'gpt-4o-mini',
        provider: 'openai',
        mode: 'chat',
      }),
    })
    await user.click(within(dialog).getByRole('button', { name: 'appGeneration.generate.apply' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.confirm',
      }),
    )

    expect(screen.getByRole('status', { name: 'Saved prompt' })).toHaveTextContent(
      'Generated prompt',
    )
    await waitFor(() =>
      expect(screen.queryByText('appGeneration.generate.title')).not.toBeInTheDocument(),
    )
  })
})
