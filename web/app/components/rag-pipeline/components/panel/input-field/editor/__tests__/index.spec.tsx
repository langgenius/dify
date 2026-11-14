import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from 'reactflow'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ChangeType } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createPipelineVariable } from '@/test/pipeline-variables'
import InputFieldEditorPanel from '../index'

const renderEditor = (initialData?: Parameters<typeof InputFieldEditorPanel>[0]['initialData']) => {
  const onSubmit = vi.fn()
  const onClose = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture({ workflow_file_upload_limit: 10 }),
  )
  renderWorkflowComponent(
    <ReactFlowProvider>
      <InputFieldEditorPanel initialData={initialData} onSubmit={onSubmit} onClose={onClose} />
    </ReactFlowProvider>,
    { queryClient },
  )
  return { onSubmit, onClose, user: userEvent.setup() }
}

it('creates a field from user input and converts the submitted form values', async () => {
  const { user, onSubmit } = renderEditor()
  await user.type(screen.getByRole('textbox', { name: /variableConfig.varName/ }), 'source_url')
  await user.tab()
  expect(screen.getByRole('textbox', { name: /variableConfig.displayName/ })).toHaveValue(
    'source_url',
  )
  await user.type(screen.getByRole('textbox', { name: /variableConfig.maxLength/ }), '48')
  await user.click(screen.getByRole('button', { name: /variableConfig.showAllSettings/ }))
  await user.type(
    screen.getByRole('textbox', { name: /variableConfig.defaultValue/ }),
    'https://example.com',
  )
  await user.type(
    screen.getByRole('textbox', { name: /variableConfig.placeholder/ }),
    'Enter a URL',
  )
  await user.click(screen.getByRole('button', { name: /operation.submit/ }))
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        variable: 'source_url',
        label: 'source_url',
        type: PipelineInputVarType.textInput,
        default_value: 'https://example.com',
        placeholder: 'Enter a URL',
        max_length: 48,
      }),
      undefined,
    ),
  )
})

it('edits a populated field and forwards rename metadata through the real form', async () => {
  const { user, onSubmit } = renderEditor(
    createPipelineVariable({ variable: 'before', label: 'Original', max_length: 100 }),
  )
  const variable = screen.getByRole('textbox', { name: /variableConfig.varName/ })
  expect(variable).toHaveValue('before')
  await user.clear(variable)
  await user.type(variable, 'after')
  await user.click(screen.getByRole('button', { name: /operation.submit/ }))
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        variable: 'after',
        label: 'Original',
        max_length: 100,
      }),
      { type: ChangeType.changeVarName, payload: { beforeKey: 'before', afterKey: 'after' } },
    ),
  )
})

it.each([
  { type: PipelineInputVarType.number, default_value: 42 },
  { type: PipelineInputVarType.checkbox, default_value: true },
])('preserves the typed default for $type when editing', async ({ type, default_value }) => {
  const { user, onSubmit } = renderEditor(createPipelineVariable({ type, default_value }))
  await user.click(screen.getByRole('button', { name: /operation.submit/ }))
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ type, default_value }),
      undefined,
    ),
  )
})

it.each([/operation.cancel/, /operation.close/])(
  'closes without submitting when %s is pressed',
  async (name) => {
    const { user, onSubmit, onClose } = renderEditor(createPipelineVariable())
    await user.click(screen.getByRole('button', { name }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  },
)
