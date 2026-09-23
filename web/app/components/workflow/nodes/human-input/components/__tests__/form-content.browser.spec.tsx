import type { HumanInputSharedNodeType } from '../../shared/types'
import { useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { BlockEnum } from '@/app/components/workflow/types'
import useHumanInputFormContent from '../../shared/use-form-content'
import FormContent from '../form-content'

const mockUseNodeCrud = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  default: (...args: unknown[]) => mockUseNodeCrud(...args),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-variables', () => ({
  useWorkflowVariableType: () => () => 'string',
  useWorkflowVariables: () => ({ getCurrentVariableType: () => 'string' }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useIsChatMode: () => false,
  useWorkflow: () => ({ handleOutVarRenameChange: vi.fn() }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { isWorkflowDataLoaded: boolean }) => unknown) =>
    selector({ isWorkflowDataLoaded: true }),
}))

vi.mock('@/service/use-plugins', () => ({
  useFetchDynamicOptions: () => ({ mutateAsync: vi.fn() }),
}))

const fieldLabel = 'workflow.nodes.humanInput.insertInputField.saveResponseAs'
const insertLabel = /workflow\.nodes\.humanInput\.insertInputField\.insert/

function placeCaretAtText(editor: Element, text: string, offset: number) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node && node.textContent !== text) node = walker.nextNode()
  if (!node) throw new Error(`Expected editor text: ${text}`)
  window.getSelection()?.collapse(node, offset)
}

function FormContentHarness() {
  const [payload, setPayload] = useState<HumanInputSharedNodeType>({
    title: 'Human Input',
    desc: '',
    type: BlockEnum.HumanInput,
    form_content: 'Before After',
    inputs: [],
    user_actions: [],
    timeout: 1,
    timeout_unit: 'day',
  })
  mockUseNodeCrud.mockReturnValue({ inputs: payload, setInputs: setPayload })
  const config = useHumanInputFormContent('human-input', payload)

  return (
    <ReactFlowProvider>
      <section aria-label="Form content" style={{ width: 480 }}>
        <FormContent
          nodeId="human-input"
          value={payload.form_content}
          onChange={config.handleFormContentChange}
          formInputs={payload.inputs}
          onFormInputsChange={config.handleFormInputsChange}
          onFormInputItemRename={config.handleFormInputItemRename}
          onFormInputItemRemove={config.handleFormInputItemRemove}
          editorKey={config.editorKey}
          isExpand={false}
          availableVars={[]}
          availableNodes={[]}
        />
      </section>
      <output aria-label="Saved form content">{payload.form_content}</output>
      <output aria-label="Saved fields">
        {payload.inputs.map((input) => input.output_variable_name).join(',')}
      </output>
    </ReactFlowProvider>
  )
}

describe('Human input output-variable insertion', () => {
  it('inserts at the saved cursor position after editing the popup and retains earlier fields', async () => {
    // Native contenteditable selection changes when the popup input takes focus.
    // Chromium must exercise that transition; a command-only test skips the regression.
    const screen = await render(<FormContentHarness />)
    const content = screen.getByRole('region', { name: 'Form content' })
    const editor = content.getByRole('textbox')
    await editor.click()
    placeCaretAtText(editor.element(), 'Before After', 'Before '.length)
    await userEvent.keyboard('{Control>}/{/Control}')
    await page.getByRole('textbox', { name: fieldLabel, exact: false }).fill('first_response')
    await page.getByRole('button', { name: insertLabel }).click()

    await expect.element(content.getByText('first_response', { exact: true })).toBeVisible()
    await expect
      .element(screen.getByRole('status', { name: 'Saved form content' }))
      .toHaveTextContent(/Before\s+\{\{#\$output.first_response#\}\}\s+After/)
    await expect
      .element(screen.getByRole('status', { name: 'Saved fields' }))
      .toHaveTextContent(/^first_response$/)

    await content.getByText('After', { exact: true }).click()
    placeCaretAtText(editor.element(), 'After', 'After'.length)
    await userEvent.keyboard('{Control>}/{/Control}')
    await page.getByRole('textbox', { name: fieldLabel, exact: false }).fill('second_response')
    await page.getByRole('button', { name: insertLabel }).click()
    await expect.element(content.getByText('first_response', { exact: true })).toBeVisible()
    await expect.element(content.getByText('second_response', { exact: true })).toBeVisible()
    await expect
      .element(screen.getByRole('status', { name: 'Saved fields' }))
      .toHaveTextContent(/^first_response,second_response$/)
    const savedContent = screen.getByRole('status', { name: 'Saved form content' })
    await expect
      .element(savedContent)
      .toHaveTextContent(
        /Before\s+\{\{#\$output.first_response#\}\}\s+After\s+\{\{#\$output.second_response#\}\}/,
      )
    const contentBeforeCancel = savedContent.element().textContent

    await content.getByText('After', { exact: true }).click()
    placeCaretAtText(editor.element(), 'After', 'After'.length)
    await userEvent.keyboard('{Control>}/{/Control}')
    await page.getByRole('textbox', { name: fieldLabel, exact: false }).fill('cancelled_response')
    await page.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect
      .element(content.getByText('cancelled_response', { exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('status', { name: 'Saved fields' }))
      .toHaveTextContent(/^first_response,second_response$/)
    expect(savedContent.element().textContent).toBe(contentBeforeCancel)
  })
})
