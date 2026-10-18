import type { FormData } from '../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { PipelineInputVarType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import InputFieldForm from '../index'

const renderForm = (overrides: Partial<FormData> = {}, supportFile = false) => {
  const initialData: FormData = {
    type: PipelineInputVarType.textInput,
    variable: 'source',
    label: 'Source',
    required: true,
    maxLength: 48,
    allowedTypesAndExtensions: {},
    ...overrides,
  }
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  const onSubmit = vi.fn()
  renderWithConsoleQuery(
    <InputFieldForm
      initialData={initialData}
      supportFile={supportFile}
      isEditMode={false}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
    { queryClient },
  )
  return { user: userEvent.setup(), onSubmit }
}

it('blocks invalid submission and accepts the corrected variable', async () => {
  const error = vi.spyOn(toast, 'error').mockReturnValue('validation-error')
  const { user, onSubmit } = renderForm({ variable: '' })
  await user.click(screen.getByRole('button', { name: /operation.submit/ }))
  await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('"variable"')))
  expect(onSubmit).not.toHaveBeenCalled()
  await user.type(screen.getByRole('textbox', { name: /variableConfig.varName/ }), 'corrected')
  await user.click(screen.getByRole('button', { name: /operation.submit/ }))
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ variable: 'corrected', label: 'Source' }),
      undefined,
    ),
  )
  error.mockRestore()
})

it('excludes file types when the form does not support files', async () => {
  const { user } = renderForm()
  await user.click(screen.getByRole('combobox', { name: /variableConfig.fieldType/ }))
  expect(
    screen.queryByRole('option', { name: /variableConfig.single-file/ }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('option', { name: /variableConfig.multi-files/ }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('option', { name: /variableConfig.text-input/ })).toBeInTheDocument()
})

it.each([
  { name: /variableConfig.single-file/, type: PipelineInputVarType.singleFile },
  { name: /variableConfig.multi-files/, type: PipelineInputVarType.multiFiles },
])('submits default upload settings after switching to $type', async ({ name, type }) => {
  const { user, onSubmit } = renderForm({}, true)
  await user.click(screen.getByRole('combobox', { name: /variableConfig.fieldType/ }))
  await user.click(screen.getByRole('option', { name }))
  await user.click(screen.getByRole('button', { name: /operation.submit/ }))
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type,
        allowedFileUploadMethods: ['local_file', 'remote_url'],
        allowedTypesAndExtensions: { allowedFileTypes: ['image'], allowedFileExtensions: [] },
        ...(type === PipelineInputVarType.multiFiles ? { maxLength: 5 } : {}),
      }),
      undefined,
    ),
  )
})

it('restores the variable name when a display name is cleared before submission', async () => {
  const { user, onSubmit } = renderForm()
  await user.clear(screen.getByRole('textbox', { name: /variableConfig.displayName/ }))
  await user.tab()
  await user.click(screen.getByRole('button', { name: /operation.submit/ }))
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ variable: 'source', label: 'source' }),
      undefined,
    ),
  )
})
