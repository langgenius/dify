import type { FormData } from '../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { PipelineInputVarType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { TransferMethod } from '@/types/app'
import InputFieldForm from '../index'

const renderForm = () => {
  const initialData: FormData = {
    type: PipelineInputVarType.paragraph,
    variable: 'existingVar',
    label: 'Display name',
    required: true,
    maxLength: 48,
    allowedFileUploadMethods: [TransferMethod.remote_url],
    allowedTypesAndExtensions: { allowedFileTypes: [], allowedFileExtensions: ['.pdf'] },
  }
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  const onSubmit = vi.fn()
  renderWithConsoleQuery(
    createElement(InputFieldForm, {
      initialData,
      supportFile: true,
      onSubmit,
      onCancel: vi.fn(),
    }),
    { queryClient },
  )
  return { user: userEvent.setup(), onSubmit, initialData }
}

// File-type defaults are already exercised through form submission in index.spec.tsx.
// Keep the remaining listener behavior at the real form's input/submission boundary.
it('preserves configured upload options when switching to text', async () => {
  const { user, onSubmit, initialData } = renderForm()
  await user.click(screen.getByRole('combobox', { name: /variableConfig.fieldType/ }))
  await user.click(screen.getByRole('option', { name: /variableConfig.text-input/ }))
  await user.click(screen.getByRole('button', { name: /operation.submit/ }))

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      {
        ...initialData,
        type: PipelineInputVarType.textInput,
      },
      undefined,
    ),
  )
})

it('restores the variable name after clearing and leaving the display name field', async () => {
  const { user, onSubmit, initialData } = renderForm()
  const displayName = screen.getByRole('textbox', { name: /variableConfig.displayName/ })
  await user.clear(displayName)
  await user.tab()

  expect(displayName).toHaveValue('existingVar')
  await user.click(screen.getByRole('button', { name: /operation.submit/ }))
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      {
        ...initialData,
        label: 'existingVar',
      },
      undefined,
    ),
  )
})
