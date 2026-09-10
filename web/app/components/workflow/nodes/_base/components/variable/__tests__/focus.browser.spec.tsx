import type { ComponentType } from 'react'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import IfElseConditionAdd from '@/app/components/workflow/nodes/if-else/components/condition-add'
import IfElseConditionVarSelector from '@/app/components/workflow/nodes/if-else/components/condition-list/condition-var-selector'
import IfElseConditionNumberInput from '@/app/components/workflow/nodes/if-else/components/condition-number-input'
import MetadataConditionVariableSelector from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/condition-list/condition-variable-selector'
import LoopConditionAdd from '@/app/components/workflow/nodes/loop/components/condition-add'
import LoopConditionVarSelector from '@/app/components/workflow/nodes/loop/components/condition-list/condition-var-selector'
import LoopConditionNumberInput from '@/app/components/workflow/nodes/loop/components/condition-number-input'
import { VarType as NumberVarType } from '@/app/components/workflow/nodes/tool/types'
import { VarType } from '@/app/components/workflow/types'
import VarReferenceVars from '../var-reference-vars'

const variables: NodeOutPutVar[] = [
  { title: 'Source', nodeId: 'source', vars: [{ variable: 'answer', type: VarType.number }] },
]

const cases: {
  name: string
  Owner: ComponentType
  triggerName: string | RegExp
  mouseOnly?: boolean
}[] = [
  {
    name: 'Loop add',
    Owner: () => <LoopConditionAdd variables={variables} onSelectVariable={vi.fn()} />,
    triggerName: 'workflow.nodes.ifElse.addCondition',
  },
  {
    name: 'IfElse add',
    Owner: () => (
      <IfElseConditionAdd caseId="case-1" variables={variables} onSelectVariable={vi.fn()} />
    ),
    triggerName: 'workflow.nodes.ifElse.addCondition',
  },
  {
    name: 'Loop number',
    Owner: () => (
      <LoopConditionNumberInput
        numberVarType={NumberVarType.variable}
        value=""
        variables={variables}
        onNumberVarTypeChange={vi.fn()}
        onValueChange={vi.fn()}
      />
    ),
    triggerName: 'workflow.nodes.ifElse.selectVariable',
  },
  {
    name: 'IfElse number',
    Owner: () => (
      <IfElseConditionNumberInput
        numberVarType={NumberVarType.variable}
        value=""
        variables={variables}
        onNumberVarTypeChange={vi.fn()}
        onValueChange={vi.fn()}
      />
    ),
    triggerName: 'workflow.nodes.ifElse.selectVariable',
  },
  {
    name: 'Metadata (existing mouse-only trigger)',
    mouseOnly: true,
    Owner: () => (
      <MetadataConditionVariableSelector nodesOutputVars={variables} onChange={vi.fn()} />
    ),
    triggerName: /workflow.nodes.knowledgeRetrieval.metadata.panel.select/,
  },
  ...[LoopConditionVarSelector, IfElseConditionVarSelector].map((Selector, index) => ({
    name: `${index === 0 ? 'Loop' : 'IfElse'} condition selector (existing mouse-only trigger)`,
    mouseOnly: true,
    Owner: function Owner() {
      const [open, setOpen] = useState(false)
      return (
        <Selector
          open={open}
          onOpenChange={setOpen}
          valueSelector={['source', 'answer']}
          varType={VarType.number}
          availableNodes={[]}
          nodesOutputVars={variables}
          onChange={vi.fn()}
        />
      )
    },
    triggerName: /answer/,
  })),
]

// Native popup focus, Tab traversal and focus restoration need a real browser.
it.each(cases)(
  '$name delegates search focus to its popup and restores its trigger',
  async ({ Owner, triggerName, mouseOnly }) => {
    const screen = await render(
      <ReactFlowProvider>
        <Owner />
      </ReactFlowProvider>,
    )
    const trigger = mouseOnly
      ? screen.getByText(triggerName)
      : screen.getByRole('button', { name: triggerName })
    const triggerElement = mouseOnly
      ? trigger.element().closest<HTMLElement>('[data-base-ui-click-trigger]')!
      : trigger.element()
    if (mouseOnly) {
      // These existing div triggers need a separate nativeButton contract fix.
      await trigger.click()
    } else {
      triggerElement.focus()
      await userEvent.keyboard('{Enter}')
    }
    const search = screen.getByRole('searchbox', { name: 'workflow.common.searchVar' })
    await expect.element(search).toHaveFocus()
    await userEvent.keyboard('answer')
    await expect.element(search).toHaveValue('answer')
    await userEvent.keyboard('{Tab}')
    const clear = screen.getByRole('button', { name: 'common.operation.clear' })
    await expect.element(clear).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(search).toHaveValue('')
    await expect.element(search).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(search).not.toBeInTheDocument()
    await expect.poll(() => document.activeElement).toBe(triggerElement)
  },
)

it('does not steal editor focus when the shared variable list mounts', async () => {
  function EditorHarness() {
    const [show, setShow] = useState(false)
    return (
      <>
        <input aria-label="Editor" onChange={() => setShow(true)} />
        {show && <VarReferenceVars vars={variables} onChange={vi.fn()} />}
      </>
    )
  }
  const screen = await render(<EditorHarness />)
  const editor = screen.getByRole('textbox', { name: 'Editor' })
  await editor.fill('/')
  await expect.element(screen.getByRole('searchbox')).toBeVisible()
  await expect.element(editor).toHaveFocus()
})
