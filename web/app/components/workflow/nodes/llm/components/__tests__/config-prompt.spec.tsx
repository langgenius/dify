import type { PromptItem } from '../../../../types'
import type { LLMNodeType } from '../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { BlockEnum, EditionType, InputVarType, PromptRole, VarType } from '../../../../types'
import useLLMInputManager from '../../hooks/use-llm-input-manager'
import useLLMPromptConfig from '../../hooks/use-llm-prompt-config'
import ConfigPrompt from '../config-prompt'

const initialPrompts: PromptItem[] = [
  { id: 'system', role: PromptRole.system, text: 'System instruction' },
  { id: 'user', role: PromptRole.user, text: 'User question' },
  { id: 'assistant', role: PromptRole.assistant, text: 'Assistant answer' },
]
const remotePrompts = initialPrompts.map(({ role, text }) => ({ role, text }))

function Fixture({ initial = initialPrompts }: { initial?: PromptItem[] }) {
  const [prompts, setPrompts] = useState(initial)
  return (
    <>
      <ConfigPrompt
        readOnly={false}
        nodeId="llm"
        filterVar={() => true}
        isChatModel
        isChatApp={false}
        payload={prompts}
        onChange={(items) => setPrompts(items as PromptItem[])}
        isShowContext={false}
        hasSetBlockStatus={{ context: false, history: false, query: false }}
        handleAddVariable={() => {}}
        modelConfig={{
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: 'chat',
          completion_params: {},
        }}
      />
      <output aria-label="Saved prompts">{JSON.stringify(prompts)}</output>
    </>
  )
}

function RemoteModelChangeFixture() {
  const [inputs, setInputs] = useState<LLMNodeType>({
    type: BlockEnum.LLM,
    title: 'LLM',
    desc: '',
    model: {
      provider: 'openai',
      name: 'completion-model',
      mode: 'completion',
      completion_params: {},
    },
    prompt_template: { text: 'Completion instruction', edition_type: EditionType.basic },
    context: { enabled: false, variable_selector: [] },
    vision: { enabled: false },
  })
  const isChatModel = inputs.model.mode === 'chat'
  const inputManager = useLLMInputManager({
    inputs,
    isChatModel,
    doSetInputs: setInputs,
  })
  const promptConfig = useLLMPromptConfig({
    inputs,
    inputRef: inputManager.inputRef,
    setInputs: inputManager.setInputs,
    isChatModel,
    isChatflow: true,
  })

  return (
    <>
      <button
        onClick={() =>
          setInputs({
            ...inputs,
            model: { ...inputs.model, name: 'chat-model', mode: 'chat' },
            prompt_template: remotePrompts,
          })
        }
      >
        Receive remote Chat model
      </button>
      <output aria-label="Model mode">{inputs.model.mode}</output>
      <output aria-label="Saved remote prompts">{JSON.stringify(inputs.prompt_template)}</output>
      <ConfigPrompt
        readOnly={false}
        nodeId="llm"
        filterVar={promptConfig.filterVar}
        isChatModel={isChatModel}
        isChatApp
        payload={inputs.prompt_template}
        onChange={promptConfig.handlePromptChange}
        isShowContext={false}
        hasSetBlockStatus={promptConfig.hasSetBlockStatus}
        handleAddVariable={promptConfig.handleAddVariable}
        modelConfig={inputs.model}
      />
    </>
  )
}

const renderPromptConfig = (ui: React.ReactElement) => {
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
  const code = createNode({
    id: 'code',
    data: {
      type: BlockEnum.Code,
      title: 'Draft data',
      outputs: { answer: { type: VarType.string, children: null } },
    },
  })
  const llm = createNode({ id: 'llm', data: { type: BlockEnum.LLM, title: 'Writer' } })

  return renderWorkflowFlowComponent(
    <EventEmitterContextProvider>{ui}</EventEmitterContextProvider>,
    {
      queryClient,
      nodes: [start, code, llm],
      edges: [
        createEdge({
          source: start.id,
          target: code.id,
          data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Code },
        }),
        createEdge({
          source: code.id,
          target: llm.id,
          data: { sourceType: BlockEnum.Code, targetType: BlockEnum.LLM },
        }),
      ],
    },
  )
}

const editorTexts = () => screen.getAllByRole('textbox').map((editor) => editor.textContent)

it('retains a remote model change without writing back its default prompts', async () => {
  const user = userEvent.setup()
  renderPromptConfig(<RemoteModelChangeFixture />)

  await user.click(screen.getByRole('button', { name: 'Receive remote Chat model' }))

  expect(screen.getByRole('status', { name: 'Model mode' })).toHaveTextContent('chat')
  expect(
    JSON.parse(screen.getByRole('status', { name: 'Saved remote prompts' }).textContent!),
  ).toEqual(remotePrompts)
  expect(editorTexts()).toEqual(initialPrompts.map((prompt) => prompt.text))
})

it('reorders messages without moving past the leading system prompt', async () => {
  const user = userEvent.setup()
  renderPromptConfig(<Fixture />)
  const savedPrompts = screen.getByRole('status', { name: 'Saved prompts' })
  const handle = screen.getAllByRole('button', { name: /common.sort.handle/ })[0]!
  for (let index = 0; index < 20 && document.activeElement !== handle; index++) await user.tab()
  expect(handle).toHaveFocus()
  await user.keyboard('{Enter}{ArrowUp}')
  expect(editorTexts()).toEqual(initialPrompts.map((item) => item.text))
  await user.keyboard('{ArrowDown}')
  expect(editorTexts()).toEqual(['System instruction', 'Assistant answer', 'User question'])
  expect(savedPrompts).toHaveTextContent(JSON.stringify(initialPrompts))
  await user.keyboard('{Enter}')
  expect(JSON.parse(savedPrompts.textContent!)).toEqual([
    initialPrompts[0],
    initialPrompts[2],
    initialPrompts[1],
  ])
  expect(screen.getAllByRole('button', { name: /common.sort.handle/ })[1]).toHaveFocus()
})

it('only writes default prompts without IDs after completing a reorder', async () => {
  const user = userEvent.setup()
  const initial = initialPrompts.map((item) => ({ role: item.role, text: item.text }))
  renderPromptConfig(<Fixture initial={initial} />)
  const savedPrompts = screen.getByRole('status', { name: 'Saved prompts' })

  const handle = screen.getAllByRole('button', { name: /common.sort.handle/ })[0]!
  for (let index = 0; index < 20 && document.activeElement !== handle; index++) await user.tab()
  expect(handle).toHaveFocus()
  await user.keyboard('{Enter}{ArrowDown}{Escape}')
  expect(JSON.parse(savedPrompts.textContent!)).toEqual(initial)
  await user.keyboard('{Enter}{ArrowDown}{Enter}')
  const reordered = JSON.parse(savedPrompts.textContent!) as PromptItem[]
  expect(reordered).toEqual(
    [initial[0], initial[2], initial[1]].map((prompt) => ({ ...prompt, id: expect.any(String) })),
  )
  expect(new Set(reordered.map((prompt) => prompt.id)).size).toBe(initial.length)
  expect(editorTexts()).toEqual(['System instruction', 'Assistant answer', 'User question'])
  await user.keyboard('{Enter}{ArrowUp}{Enter}')
  expect(JSON.parse(savedPrompts.textContent!)).toEqual([reordered[0], reordered[2], reordered[1]])
})
