import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import IfElseConditionVarSelector from '@/app/components/workflow/nodes/if-else/components/condition-list/condition-var-selector'
import ConditionVariableSelector from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/condition-list/condition-variable-selector'
import LoopConditionVarSelector from '@/app/components/workflow/nodes/loop/components/condition-list/condition-var-selector'
import { VarType } from '@/app/components/workflow/types'

vi.mock('@/app/components/workflow/nodes/_base/components/variable-tag', () => ({
  default: () => <span>selected variable</span>,
}))

const baseProps = {
  valueSelector: [],
  varType: VarType.string,
  availableNodes: [],
  nodesOutputVars: [],
  onChange: vi.fn(),
}

const renderIfElseSelector = () => {
  const Harness = () => {
    const [open, setOpen] = useState(false)
    return <IfElseConditionVarSelector {...baseProps} open={open} onOpenChange={setOpen} />
  }

  render(<Harness />)
}

const renderLoopSelector = () => {
  const Harness = () => {
    const [open, setOpen] = useState(false)
    return <LoopConditionVarSelector {...baseProps} open={open} onOpenChange={setOpen} />
  }

  render(<Harness />)
}

const renderKnowledgeSelector = () => {
  render(<ConditionVariableSelector {...baseProps} />)
}

const selectors = [
  ['If/Else', renderIfElseSelector],
  ['Loop', renderLoopSelector],
  ['Knowledge Retrieval metadata', renderKnowledgeSelector],
] as const

const assertKeyboardActivation = async (renderSelector: () => void, key: string) => {
  const user = userEvent.setup()
  renderSelector()

  const trigger = screen.getByRole('button')
  await user.tab()
  expect(trigger).toHaveFocus()

  await user.keyboard(key)
  expect(await screen.findByRole('searchbox', { name: 'workflow.common.searchVar' })).toHaveFocus()
}

describe('workflow condition variable selectors', () => {
  it.each(selectors)('%s opens with Enter', async (_, renderSelector) => {
    await assertKeyboardActivation(renderSelector, '{Enter}')
  })

  it.each(selectors)('%s opens with Space', async (_, renderSelector) => {
    await assertKeyboardActivation(renderSelector, ' ')
  })
})
