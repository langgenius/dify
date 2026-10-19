import type { ComponentProps, ReactElement } from 'react'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { ReactFlowProvider } from 'reactflow'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowContext } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDefaultParagraphFormInput } from '../../types'
import FormContent from '../form-content'

it('preserves the shortcut draft and inserts at the editor selection after focus moves into the input form', async () => {
  // Native focus and selection must survive the portal and parent rerender; a callback stub cannot prove insertion.
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  const store = createWorkflowStore({})
  const props: ComponentProps<typeof FormContent> = {
    nodeId: 'approval',
    value: 'Initial content',
    onChange: vi.fn(),
    formInputs: [createDefaultParagraphFormInput('existing')],
    onFormInputsChange: vi.fn(),
    onFormInputItemRename: vi.fn(),
    onFormInputItemRemove: vi.fn(),
    editorKey: 1,
    isExpand: false,
    availableVars: [],
    availableNodes: [
      createNode({ id: 'approval', data: { title: 'Approval', type: BlockEnum.HumanInput } }),
    ],
  }
  const wrap = (ui: ReactElement) => (
    <QueryProvider>
      <EditorResourceScope resource={{ kind: 'snippet', snippetId: 'form-test' }}>
        <WorkflowContext value={store}>
          <ReactFlowProvider>{ui}</ReactFlowProvider>
        </WorkflowContext>
      </EditorResourceScope>
    </QueryProvider>
  )
  const screen = await render(wrap(<FormContent {...props} />))
  const editor = screen.getByRole('textbox')
  await editor.click()
  await userEvent.keyboard('{End}')
  const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await userEvent.keyboard(`{${mod}>}/{/${mod}}`)
  const name = screen.getByRole('textbox', { name: /insertInputField.saveResponseAs/ })
  await expect.element(name).toHaveFocus()
  await name.fill('existing')
  const insert = screen.getByRole('button', { name: /insertInputField.insert/ })
  await expect.element(insert).toBeDisabled()
  await expect.element(screen.getByText(/insertInputField.variableNameDuplicated/)).toBeVisible()
  await name.fill('approval')
  await screen.rerender(wrap(<FormContent {...props} />))
  await expect.element(name).toHaveValue('approval')
  await insert.click()
  await expect.element(name).not.toBeInTheDocument()
  await expect
    .poll(() => vi.mocked(props.onChange).mock.lastCall?.[0])
    .toBe('Initial content\n{{#$output.approval#}}\n')
  expect(props.onFormInputsChange).not.toHaveBeenCalled()
  await screen.rerender(
    wrap(<FormContent {...props} value={'Initial content\n{{#$output.approval#}}\n'} />),
  )
  await expect
    .poll(() => vi.mocked(props.onFormInputsChange).mock.calls)
    .toEqual([[[...props.formInputs, createDefaultParagraphFormInput('approval')]]])
  await expect
    .element(screen.getByRole('textbox').getByText('approval', { exact: true }))
    .toBeVisible()
  queryClient.clear()
})
