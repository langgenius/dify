import type { FormData } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppForm } from '@/app/components/base/form'
import { PipelineInputVarType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import HiddenFields from '../hidden-fields'

const renderFields = (values: Partial<FormData>) => {
  const initialData: NonNullable<Parameters<typeof HiddenFields>[0]['initialData']> = {
    variable: 'source',
    label: 'Source',
    required: false,
    type: PipelineInputVarType.textInput,
    allowedTypesAndExtensions: {},
    ...values,
  }
  const Fields = HiddenFields({ initialData })
  const Harness = () => {
    const form = useAppForm({ defaultValues: initialData })
    return <Fields form={form} />
  }
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture({ workflow_file_upload_limit: 10 }),
  )
  return renderWithConsoleQuery(<Harness />, { queryClient })
}

it('shows text settings with their saved values and excludes number-only settings', async () => {
  const user = userEvent.setup()
  renderFields({ default: 'Saved default', placeholder: 'Enter source', tooltips: 'Help' })
  const defaultInput = screen.getByRole('textbox', { name: /variableConfig.defaultValue/ })
  expect(defaultInput).toHaveValue('Saved default')
  expect(screen.getByRole('textbox', { name: /variableConfig.placeholder/ })).toHaveValue(
    'Enter source',
  )
  expect(screen.getByRole('textbox', { name: /variableConfig.tooltips/ })).toHaveValue('Help')
  expect(screen.queryByRole('textbox', { name: /variableConfig.unit/ })).not.toBeInTheDocument()
  await user.clear(defaultInput)
  await user.type(defaultInput, 'Edited')
  expect(defaultInput).toHaveValue('Edited')
})

it('builds the default selection from configured options', async () => {
  const user = userEvent.setup()
  renderFields({
    type: PipelineInputVarType.select,
    options: ['Option A', 'Option B'],
    default: 'Option A',
  })
  const select = screen.getByRole('combobox', { name: /variableConfig.startSelectedOption/ })
  expect(select).toHaveTextContent('Option A')
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: 'Option B' }))
  expect(select).toHaveTextContent('Option B')
  expect(
    screen.queryByRole('textbox', { name: /variableConfig.placeholder/ }),
  ).not.toBeInTheDocument()
})
