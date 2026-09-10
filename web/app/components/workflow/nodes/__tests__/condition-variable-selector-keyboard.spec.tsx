import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { VarType } from '@/app/components/workflow/types'
import IfElseConditionVarSelector from '../if-else/components/condition-list/condition-var-selector'
import KnowledgeConditionVariableSelector from '../knowledge-retrieval/components/metadata/condition-list/condition-variable-selector'
import LoopConditionVarSelector from '../loop/components/condition-list/condition-var-selector'

const answer = { variable: 'answer', type: VarType.number }
const variables: NodeOutPutVar[] = [{ nodeId: 'source', title: 'Source', vars: [answer] }]

function IfElseSelectorHarness() {
  const [open, setOpen] = useState(false)
  return (
    <IfElseConditionVarSelector
      open={open}
      onOpenChange={setOpen}
      valueSelector={['source', 'previous']}
      varType={VarType.number}
      availableNodes={[]}
      nodesOutputVars={variables}
      onChange={vi.fn()}
    />
  )
}

function LoopSelectorHarness() {
  const [open, setOpen] = useState(false)
  return (
    <LoopConditionVarSelector
      open={open}
      onOpenChange={setOpen}
      valueSelector={['source', 'previous']}
      varType={VarType.number}
      availableNodes={[]}
      nodesOutputVars={variables}
      onChange={vi.fn()}
    />
  )
}

function KnowledgeSelectorHarness() {
  return (
    <KnowledgeConditionVariableSelector
      nodesOutputVars={variables}
      onChange={vi.fn()}
    />
  )
}

const selectorCases = [
  ['If/Else', IfElseSelectorHarness],
  ['Loop', LoopSelectorHarness],
  ['Knowledge Retrieval metadata', KnowledgeSelectorHarness],
] as const

const activationKeys = [
  ['Enter', '{Enter}'],
  ['Space', ' '],
] as const

describe.each(selectorCases)('%s condition variable selector', (_name, SelectorHarness) => {
  it.each(activationKeys)('opens from the keyboard with %s', async (_keyName, key) => {
    const user = userEvent.setup()
    render(
      <ReactFlowProvider>
        <SelectorHarness />
      </ReactFlowProvider>,
    )

    await user.tab()
    const trigger = screen.getByRole('button')
    expect(trigger).toHaveFocus()

    await user.keyboard(key)

    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })
})
