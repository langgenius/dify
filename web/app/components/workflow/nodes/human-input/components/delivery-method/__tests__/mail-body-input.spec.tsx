import type { PromptEditorProps } from '@/app/components/base/prompt-editor'
import { render } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import MailBodyInput from '../mail-body-input'

// The email adapter owns node-name mapping; PromptEditor owns token editing.
const promptEditor = vi.hoisted(() => vi.fn())
vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: PromptEditorProps) => {
    promptEditor(props)
    return null
  },
}))

it('adds a system-variable alias only when the available nodes include Start', () => {
  const { rerender } = render(
    <MailBodyInput
      availableNodes={[
        createNode({ id: 'start', data: { title: 'Start Node', type: BlockEnum.Start } }),
        createNode({ id: 'answer', data: { title: 'Answer Node', type: BlockEnum.Answer } }),
      ]}
    />,
  )
  expect(promptEditor).toHaveBeenLastCalledWith(
    expect.objectContaining({
      workflowVariableBlock: expect.objectContaining({
        workflowNodesMap: {
          start: { title: 'Start Node', type: BlockEnum.Start },
          answer: { title: 'Answer Node', type: BlockEnum.Answer },
          sys: { title: 'workflow.blocks.start', type: BlockEnum.Start },
        },
      }),
    }),
  )
  rerender(
    <MailBodyInput
      availableNodes={[createNode({ id: 'llm', data: { title: 'LLM Node', type: BlockEnum.LLM } })]}
    />,
  )
  expect(promptEditor).toHaveBeenLastCalledWith(
    expect.objectContaining({
      workflowVariableBlock: expect.objectContaining({
        workflowNodesMap: { llm: { title: 'LLM Node', type: BlockEnum.LLM } },
      }),
    }),
  )
})
