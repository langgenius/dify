import type { HumanInputSharedNodeType } from '../../shared/types'
import { detectPlatform } from '@tanstack/react-hotkeys'
import ReactFlow, { ReactFlowProvider, useNodes } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowContext } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { createHooksStore } from '@/app/components/workflow/hooks-store/store'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import useHumanInputFormContent from '../../shared/use-form-content'
import FormContent from '../form-content'

const fieldLabel = 'workflowHumanInput.nodes.humanInput.insertInputField.saveResponseAs'
const insertLabel = /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/

function placeCaretAtText(editor: Element, text: string, offset: number) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node && node.textContent !== text) node = walker.nextNode()
  if (!node) throw new Error(`Expected editor text: ${text}`)
  window.getSelection()?.collapse(node, offset)
}

const initialPayload: HumanInputSharedNodeType = {
  title: 'Human Input',
  desc: '',
  type: BlockEnum.HumanInput,
  form_content: 'Before After',
  inputs: [],
  user_actions: [],
  timeout: 1,
  timeout_unit: 'day',
}

// Edits flow through the real node CRUD hooks into the React Flow node, as in the editor panel.
function LiveFormContent() {
  const node = useNodes<HumanInputSharedNodeType>().find((item) => item.id === 'human-input')
  return node ? <FormContentHarness payload={node.data} /> : null
}

function FormContentHarness({ payload }: { payload: HumanInputSharedNodeType }) {
  const config = useHumanInputFormContent('human-input', payload)

  return (
    <>
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
    </>
  )
}

async function renderFormContent() {
  onTestFinished(guardUnexpectedFetch())
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return render(
    <QueryProvider>
      <EditorResourceScope resource={{ kind: 'snippet', snippetId: 'human-input-test' }}>
        <WorkflowContext value={createWorkflowStore({})}>
          <HooksStoreContext value={createHooksStore({ doSyncWorkflowDraft: async () => {} })}>
            <EventEmitterContextProvider>
              <ReactFlowProvider>
                <div style={{ width: 1, height: 1 }}>
                  <ReactFlow
                    defaultNodes={[createNode({ id: 'human-input', data: initialPayload })]}
                  />
                </div>
                <LiveFormContent />
              </ReactFlowProvider>
            </EventEmitterContextProvider>
          </HooksStoreContext>
        </WorkflowContext>
      </EditorResourceScope>
    </QueryProvider>,
  )
}

describe('Human input output-variable insertion', () => {
  it('inserts at the saved cursor position after editing the popup and retains earlier fields', async () => {
    // Native contenteditable selection changes when the popup input takes focus.
    // Chromium must exercise that transition; a command-only test skips the regression.
    const modifier = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    const shortcut = `{${modifier}>}/{/${modifier}}`
    const screen = await renderFormContent()
    const content = screen.getByRole('region', { name: 'Form content' })
    const editor = content.getByRole('textbox')
    await editor.click()
    placeCaretAtText(editor.element(), 'Before After', 'Before '.length)
    await userEvent.keyboard(shortcut)
    await page.getByRole('textbox', { name: fieldLabel, exact: false }).fill('first_response')
    await page.getByRole('button', { name: insertLabel }).click()

    await expect.element(content.getByText('first_response', { exact: true })).toBeVisible()
    await expect
      .element(screen.getByRole('status', { name: 'Saved form content' }))
      .toMatchTextContent(/Before\s+\{\{#\$output.first_response#\}\}\s+After/)
    await expect
      .element(screen.getByRole('status', { name: 'Saved fields' }))
      .toHaveTextContent('first_response')

    await content.getByText('After', { exact: true }).click()
    placeCaretAtText(editor.element(), 'After', 'After'.length)
    await userEvent.keyboard(shortcut)
    await page.getByRole('textbox', { name: fieldLabel, exact: false }).fill('second_response')
    await page.getByRole('button', { name: insertLabel }).click()
    await expect.element(content.getByText('first_response', { exact: true })).toBeVisible()
    await expect.element(content.getByText('second_response', { exact: true })).toBeVisible()
    await expect
      .element(screen.getByRole('status', { name: 'Saved fields' }))
      .toHaveTextContent('first_response,second_response')
    const savedContent = screen.getByRole('status', { name: 'Saved form content' })
    await expect
      .element(savedContent)
      .toMatchTextContent(
        /Before\s+\{\{#\$output.first_response#\}\}\s+After\s+\{\{#\$output.second_response#\}\}/,
      )
    const contentBeforeCancel = savedContent.element().textContent

    await content.getByText('After', { exact: true }).click()
    placeCaretAtText(editor.element(), 'After', 'After'.length)
    await userEvent.keyboard(shortcut)
    await page.getByRole('textbox', { name: fieldLabel, exact: false }).fill('cancelled_response')
    await page.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect
      .element(content.getByText('cancelled_response', { exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('status', { name: 'Saved fields' }))
      .toHaveTextContent('first_response,second_response')
    await expect.poll(() => savedContent.element().textContent).toBe(contentBeforeCancel)
  })
})
