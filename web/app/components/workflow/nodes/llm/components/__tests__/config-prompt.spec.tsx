import type { PromptItem } from '../../../../types'
import type { LLMNodeType } from '../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, EditionType, PromptRole } from '../../../../types'
import useLLMInputManager from '../../hooks/use-llm-input-manager'
import useLLMPromptConfig from '../../hooks/use-llm-prompt-config'
import ConfigPrompt from '../config-prompt'

vi.mock('../../../_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))

vi.mock('../../../_base/components/prompt/editor', () => ({ default: () => null }))

vi.mock('../config-prompt-item', () => ({
  default: ({
    payload,
    onPromptChange,
  }: {
    payload: PromptItem
    onPromptChange: (value: string) => void
  }) => (
    <textarea
      aria-label={payload.role}
      value={payload.text}
      onChange={(event) => onPromptChange(event.target.value)}
    />
  ),
}))

const initialPrompts: PromptItem[] = [
  { id: 'system', role: PromptRole.system, text: 'System instruction' },
  { id: 'user', role: PromptRole.user, text: 'User question' },
  { id: 'assistant', role: PromptRole.assistant, text: 'Assistant answer' },
]

function Fixture({
  onChange,
  initial = initialPrompts,
}: {
  onChange: (items: PromptItem | PromptItem[]) => void
  initial?: PromptItem[]
}) {
  const [prompts, setPrompts] = useState(initial)
  return (
    <ConfigPrompt
      readOnly={false}
      nodeId="llm"
      filterVar={() => true}
      isChatModel
      isChatApp={false}
      payload={prompts}
      onChange={(items) => {
        onChange(items)
        setPrompts(items as PromptItem[])
      }}
      isShowContext={false}
      hasSetBlockStatus={{ context: false, history: false, query: false }}
      handleAddVariable={vi.fn()}
      modelConfig={{ provider: 'openai', name: 'gpt-4', mode: 'chat', completion_params: {} }}
    />
  )
}

function RemoteModelChangeFixture({ onChange }: { onChange: (inputs: LLMNodeType) => void }) {
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
    doSetInputs: (nextInputs) => {
      onChange(nextInputs)
      setInputs(nextInputs)
    },
  })
  const promptConfig = useLLMPromptConfig({
    inputs,
    inputRef: inputManager.inputRef,
    setInputs: inputManager.setInputs,
    isChatModel,
    isChatMode: true,
  })

  return (
    <>
      <button
        onClick={() =>
          setInputs({
            ...inputs,
            model: { ...inputs.model, name: 'chat-model', mode: 'chat' },
            prompt_template: initialPrompts.map(({ role, text }) => ({ role, text })),
          })
        }
      >
        Receive remote Chat model
      </button>
      <output aria-label="Model mode">{inputs.model.mode}</output>
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

it('retains a remote model change without writing back its default prompts', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn<(inputs: LLMNodeType) => void>()
  renderWorkflowComponent(<RemoteModelChangeFixture onChange={onChange} />)

  await user.click(screen.getByRole('button', { name: 'Receive remote Chat model' }))

  expect(screen.getByRole('status', { name: 'Model mode' })).toHaveTextContent('chat')
  expect(onChange).not.toHaveBeenCalled()
  expect(
    screen.getAllByRole('textbox').map((editor) => (editor as HTMLTextAreaElement).value),
  ).toEqual(initialPrompts.map((prompt) => prompt.text))
})

it('reorders messages without moving past the leading system prompt', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  renderWorkflowComponent(<Fixture onChange={onChange} />)
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(2)
  const handle = screen.getAllByRole('button', { pressed: false })[0]!
  for (let index = 0; index < 10 && document.activeElement !== handle; index++) await user.tab()
  expect(handle).toHaveFocus()
  await user.keyboard('{Enter}{ArrowUp}')
  expect(
    screen.getAllByRole('textbox').map((input) => (input as HTMLTextAreaElement).value),
  ).toEqual(initialPrompts.map((item) => item.text))
  await user.keyboard('{ArrowDown}')
  expect(
    screen.getAllByRole('textbox').map((input) => (input as HTMLTextAreaElement).value),
  ).toEqual(['System instruction', 'Assistant answer', 'User question'])
  expect(onChange).not.toHaveBeenCalled()
  await user.keyboard('{Enter}')
  expect(onChange).toHaveBeenCalledExactlyOnceWith([
    initialPrompts[0],
    initialPrompts[2],
    initialPrompts[1],
  ])
  expect(screen.getAllByRole('button', { pressed: false })[1]).toHaveFocus()
})

it('only writes default prompts without IDs after completing a reorder', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn<(items: PromptItem | PromptItem[]) => void>()
  const initial = initialPrompts.map((item) => ({ role: item.role, text: item.text }))
  renderWorkflowComponent(<Fixture onChange={onChange} initial={initial} />)
  expect(onChange).not.toHaveBeenCalled()

  const handle = screen.getAllByRole('button', { pressed: false })[0]!
  for (let index = 0; index < 10 && document.activeElement !== handle; index++) await user.tab()
  expect(handle).toHaveFocus()
  await user.keyboard('{Enter}{ArrowDown}{Escape}')
  expect(onChange).not.toHaveBeenCalled()
  await user.keyboard('{Enter}{ArrowDown}{Enter}')
  expect(onChange).toHaveBeenCalledExactlyOnceWith(
    [initial[0], initial[2], initial[1]].map((prompt) => ({ ...prompt, id: expect.any(String) })),
  )
  const reordered = onChange.mock.lastCall![0] as PromptItem[]
  expect(new Set(reordered.map((prompt) => prompt.id)).size).toBe(initial.length)
  expect(
    screen.getAllByRole('textbox').map((editor) => (editor as HTMLTextAreaElement).value),
  ).toEqual(['System instruction', 'Assistant answer', 'User question'])
  await user.keyboard('{Enter}{ArrowUp}{Enter}')
  expect(onChange).toHaveBeenCalledTimes(2)
  expect(onChange).toHaveBeenLastCalledWith([reordered[0], reordered[2], reordered[1]])
})
