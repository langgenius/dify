import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { ReactFlowProvider } from 'reactflow'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { VarType } from '@/app/components/workflow/types'
import VarReferencePicker from '../var-reference-picker'

vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useIsChatMode: () => false,
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-variables', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/components/workflow/hooks/use-workflow-variables')
  >()),
  useWorkflowVariables: () => ({ getCurrentVariableType: () => undefined }),
}))
vi.mock('../../../hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))
vi.mock('@/service/use-plugins', () => ({
  useFetchDynamicOptions: () => ({ mutateAsync: vi.fn() }),
}))

async function renderPicker(vars: NodeOutPutVar[], popupFor?: 'toAssigned') {
  const onChange = vi.fn()
  const screen = await render(
    <ReactFlowProvider>
      <WorkflowContextProvider>
        <VarReferencePicker
          nodeId="current"
          readonly={false}
          value={[]}
          onChange={onChange}
          availableVars={vars}
          popupFor={popupFor}
          placeholder="Choose variable"
        />
      </WorkflowContextProvider>
    </ReactFlowProvider>,
  )
  return { screen, onChange }
}

// Exercise the actual popup owner: browser focus fallback depends on rendered tabbables.
it('focuses common picker search and restores the trigger after keyboard selection', async () => {
  const { screen, onChange } = await renderPicker([
    { nodeId: 'source', title: 'Source', vars: [{ variable: 'answer', type: VarType.string }] },
  ])
  const trigger = screen.getByRole('button', { name: 'Choose variable' })
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  const search = screen.getByRole('searchbox', { name: 'workflow.common.searchVar' })
  await expect.element(search).toHaveFocus()
  await userEvent.keyboard('answer{Enter}')
  expect(onChange).toHaveBeenCalledWith(
    ['source', 'answer'],
    'constant',
    expect.objectContaining({ variable: 'answer' }),
  )
  await expect.element(search).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})

it('falls back to the empty assignment popup and restores focus on Escape', async () => {
  const { screen } = await renderPicker([], 'toAssigned')
  const trigger = screen.getByRole('button', { name: 'Choose variable' })
  await trigger.click()
  await expect.element(screen.getByRole('searchbox')).not.toBeInTheDocument()
  await expect.element(screen.getByText('workflow.variableReference.noAvailableVars')).toBeVisible()
  await expect.element(screen.getByRole('dialog')).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
