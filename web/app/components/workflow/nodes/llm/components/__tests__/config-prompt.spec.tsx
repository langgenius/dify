import type { PromptItem } from '../../../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { PromptRole } from '../../../../types'
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

it('persists unique IDs for default prompts once and retains them when sorting', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn<(items: PromptItem | PromptItem[]) => void>()
  const initial = initialPrompts.map((item) => ({ role: item.role, text: item.text }))
  renderWorkflowComponent(<Fixture onChange={onChange} initial={initial} />)
  expect(onChange).toHaveBeenCalledTimes(1)
  const initialized = onChange.mock.calls[0]![0] as PromptItem[]
  expect(initialized).toEqual(initial.map((item) => ({ ...item, id: expect.any(String) })))
  expect(new Set(initialized.map((item) => item.id)).size).toBe(initial.length)

  const handle = screen.getAllByRole('button', { pressed: false })[0]!
  for (let index = 0; index < 10 && document.activeElement !== handle; index++) await user.tab()
  expect(handle).toHaveFocus()
  await user.keyboard('{Enter}{ArrowDown}{Escape}')
  expect(onChange).toHaveBeenCalledTimes(1)
  await user.keyboard('{Enter}{ArrowDown}{Enter}')
  expect(onChange).toHaveBeenCalledTimes(2)
  expect(onChange).toHaveBeenLastCalledWith([initialized[0], initialized[2], initialized[1]])
})
