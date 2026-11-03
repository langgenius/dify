import type { ComponentProps, ReactElement } from 'react'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { ReactFlowProvider } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
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

function createFormContentFixture() {
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
  return { queryClient, props, wrap }
}

it('preserves the shortcut draft and inserts at the editor selection after focus moves into the input form', async () => {
  // Native focus and selection must survive the portal and parent rerender; a callback stub cannot prove insertion.
  const { queryClient, props, wrap } = createFormContentFixture()
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

it('restores field editing and removal after the mounted editor leaves readonly mode', async () => {
  // Native hover and clicks inside Lexical must reach the recreated action buttons without remounting the editor.
  const { queryClient, props, wrap } = createFormContentFixture()
  const field = createDefaultParagraphFormInput('notes')
  const fieldProps = {
    ...props,
    value: '{{#$output.notes#}}',
    formInputs: [{ ...field, default: { ...field.default, value: 'Review notes' } }],
  }
  const subject = (readonly: boolean) =>
    wrap(
      <section aria-label="Form content" style={{ width: 480, padding: 24 }}>
        <FormContent {...fieldProps} readonly={readonly} />
      </section>,
    )
  const screen = await render(subject(false))
  const content = screen.getByRole('region', { name: 'Form content' })
  const edit = content.getByRole('button', { name: 'common.operation.edit' })
  const remove = content.getByRole('button', { name: 'common.operation.remove' })
  try {
    await content.getByText('Review notes', { exact: true }).hover()
    await edit.click()
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()

    await screen.rerender(subject(true))
    await expect.element(edit).not.toBeInTheDocument()
    await expect.element(remove).not.toBeInTheDocument()
    await screen.rerender(subject(false))
    await content.getByText('Review notes', { exact: true }).hover()
    await edit.click()
    await expect.element(dialog).toBeVisible()
    await expect
      .element(dialog.getByRole('textbox', { name: /saveResponseAs/ }))
      .toHaveValue('notes')
    await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()

    await content.getByText('Review notes', { exact: true }).hover()
    await remove.click()
    expect(props.onFormInputItemRemove).toHaveBeenCalledExactlyOnceWith('notes')
  } finally {
    queryClient.clear()
  }
})
