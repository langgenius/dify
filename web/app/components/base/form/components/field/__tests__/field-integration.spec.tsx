import type { ReactElement } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppForm } from '@/app/components/base/form'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { TransferMethod } from '@/types/app'
import CheckboxField from '../checkbox'
import FileTypesField from '../file-types'
import FileUploaderField from '../file-uploader'
import InputTypeSelectField from '../input-type-select'
import NumberInputField from '../number-input'
import NumberSliderField from '../number-slider'
import OptionsField from '../options'
import SelectField from '../select'
import TextAreaField from '../text-area'

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ token: 'test-token' }),
  usePathname: () => '/',
}))

const renderField = (field: ReactElement, initialValue: unknown) => {
  const Harness = () => {
    const form = useAppForm({ defaultValues: { value: initialValue } })
    return (
      <>
        <form.AppField name="value">{() => field}</form.AppField>
        <form.Subscribe selector={(state) => state.values}>
          {(values) => <output aria-label="Form values">{JSON.stringify(values)}</output>}
        </form.Subscribe>
      </>
    )
  }
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  return renderWithConsoleQuery(<Harness />, { queryClient })
}
const readValue = () =>
  JSON.parse(screen.getByRole('status', { name: 'Form values' }).textContent!).value

it('writes checkbox changes to the form and supports toggling twice', async () => {
  const user = userEvent.setup()
  renderField(<CheckboxField label="Enabled" />, false)
  const checkbox = screen.getByRole('checkbox', { name: 'Enabled' })
  await user.click(checkbox)
  expect(checkbox).toBeChecked()
  expect(readValue()).toBe(true)
  await user.click(checkbox)
  expect(readValue()).toBe(false)
})

it('writes textarea edits into the form', async () => {
  const user = userEvent.setup()
  renderField(<TextAreaField label="Note" />, 'Initial')
  const input = screen.getByRole('textbox', { name: 'Note' })
  await user.clear(input)
  await user.type(input, 'Updated')
  expect(readValue()).toBe('Updated')
  expect(input).toHaveValue('Updated')
})

it('writes numeric values, clamps edits and resets cleared values to zero', async () => {
  const user = userEvent.setup()
  renderField(<NumberInputField label="Count" min={0} max={10} />, 2)
  await user.click(screen.getByRole('button', { name: 'Increment value' }))
  expect(readValue()).toBe(3)
  const input = screen.getByRole('textbox', { name: 'Count' })
  fireEvent.change(input, { target: { value: '12' } })
  expect(readValue()).toBe(10)
  await user.click(input)
  await user.tab()
  await waitFor(() => expect(input).toHaveValue('10'))
  await user.clear(input)
  expect(readValue()).toBe(0)
})

it('writes slider changes and clamps numeric input on blur', async () => {
  const user = userEvent.setup()
  renderField(<NumberSliderField label="Threshold" min={0} max={10} />, 2)
  const slider = screen.getByRole('slider', { name: 'Threshold' })
  slider.focus()
  await user.keyboard('{ArrowRight}')
  expect(readValue()).toBe(3)
  const input = screen.getByRole('spinbutton', { name: 'Threshold' })
  await user.clear(input)
  await user.type(input, '12')
  await user.tab()
  expect(readValue()).toBe(10)
})

it('keeps the empty selection label and writes the chosen option to the form', async () => {
  const user = userEvent.setup()
  renderField(
    <SelectField
      label="Mode"
      options={[
        { label: 'None', value: '' },
        { label: 'Beta', value: 'beta' },
      ]}
    />,
    '',
  )
  const select = screen.getByRole('combobox', { name: 'Mode' })
  expect(select).toHaveTextContent('None')
  await user.click(select)
  await user.click(screen.getByRole('option', { name: 'Beta' }))
  expect(select).toHaveTextContent('Beta')
  expect(readValue()).toBe('beta')
})

it('adds, edits and removes option strings in the form', async () => {
  const user = userEvent.setup()
  renderField(<OptionsField label="Options" />, ['Existing'])
  await user.click(screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }))
  await user.type(
    screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 2' }),
    'Added',
  )
  expect(readValue()).toEqual(['Existing', 'Added'])
  await user.click(screen.getAllByRole('button', { name: 'common.operation.delete' })[0]!)
  expect(readValue()).toEqual(['Added'])
})

it('switches between custom and standard file types without losing custom extensions', async () => {
  const user = userEvent.setup()
  renderField(<FileTypesField label="Allowed files" />, {
    allowedFileTypes: ['document'],
    allowedFileExtensions: [],
  })
  const customName = 'appDebug.variableConfig.file.custom.name'
  await user.click(screen.getByRole('checkbox', { name: customName }))
  expect(readValue()).toEqual({ allowedFileTypes: ['custom'], allowedFileExtensions: [] })
  await user.type(screen.getByRole('textbox', { name: customName }), '.csv{Enter}')
  expect(readValue()).toEqual({ allowedFileTypes: ['custom'], allowedFileExtensions: ['.csv'] })
  await user.click(
    screen.getByRole('checkbox', { name: 'appDebug.variableConfig.file.image.name' }),
  )
  expect(readValue()).toEqual({ allowedFileTypes: ['image'], allowedFileExtensions: ['.csv'] })
  await user.click(
    screen.getByRole('checkbox', { name: 'appDebug.variableConfig.file.image.name' }),
  )
  expect(readValue().allowedFileTypes).toEqual([])
})

it.each([true, false])(
  'writes input type choices and honors file support=%s',
  async (supportFile) => {
    const user = userEvent.setup()
    renderField(<InputTypeSelectField label="Input type" supportFile={supportFile} />, 'text-input')
    await user.click(screen.getByRole('combobox', { name: 'Input type' }))
    if (supportFile)
      expect(
        screen.getByRole('option', { name: /appDebug.variableConfig.single-file/ }),
      ).toBeInTheDocument()
    else
      expect(
        screen.queryByRole('option', { name: /appDebug.variableConfig.single-file/ }),
      ).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /appDebug.variableConfig.number/ }))
    expect(readValue()).toBe('number')
  },
)

it('removes an uploaded file from both the field and the form state', async () => {
  const user = userEvent.setup()
  renderField(
    <FileUploaderField
      label="Attachments"
      fileConfig={{
        allowed_file_upload_methods: [TransferMethod.local_file],
        allowed_file_types: [SupportUploadFileTypes.document],
      }}
    />,
    [
      {
        id: 'file-1',
        name: 'report.pdf',
        size: 1024,
        type: 'application/pdf',
        progress: 100,
        transferMethod: TransferMethod.local_file,
        supportFileType: SupportUploadFileTypes.document,
        uploadedId: 'uploaded-1',
        url: 'https://example.com/report.pdf',
      },
    ],
  )
  expect(screen.getByText('report.pdf')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /remove|delete/i }))
  expect(screen.queryByText('report.pdf')).not.toBeInTheDocument()
  expect(readValue()).toEqual([])
})
