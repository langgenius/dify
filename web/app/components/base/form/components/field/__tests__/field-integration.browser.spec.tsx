import type { ReactElement } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { useAppForm } from '@/app/components/base/form'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
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

const renderField = async (field: ReactElement, initialValue: unknown) => {
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
  const { wrapper: Wrapper } = createConsoleQueryWrapper({ queryClient })
  const screen = await render(
    <Wrapper>
      <Harness />
    </Wrapper>,
  )
  await expect.element(page.getByRole('status', { name: 'Form values' })).toBeVisible()
  return screen
}
const readValue = () =>
  JSON.parse(page.getByRole('status', { name: 'Form values' }).element().textContent!).value

it('writes checkbox changes to the form and supports toggling twice', async () => {
  await renderField(<CheckboxField label="Enabled" />, false)
  const checkbox = page.getByRole('checkbox', { name: 'Enabled' })
  await checkbox.click()
  await expect.element(checkbox).toBeChecked()
  await expect.poll(readValue).toBe(true)
  await checkbox.click()
  await expect.poll(readValue).toBe(false)
})

it('writes textarea edits into the form', async () => {
  await renderField(<TextAreaField label="Note" />, 'Initial')
  const input = page.getByRole('textbox', { name: 'Note' })
  await input.fill('')
  await input.fill('Updated')
  await expect.poll(readValue).toBe('Updated')
  await expect.element(input).toHaveValue('Updated')
})

it('writes numeric values, clamps edits and resets cleared values to zero', async () => {
  await renderField(<NumberInputField label="Count" min={0} max={10} />, 2)
  await page.getByRole('button', { name: 'Increment value' }).click()
  await expect.poll(readValue).toBe(3)
  const input = page.getByRole('textbox', { name: 'Count' })
  await input.fill('12')
  await userEvent.tab()
  await expect.poll(readValue).toBe(10)
  await input.click()
  await userEvent.tab()
  await expect.element(input).toHaveValue('10')
  await input.fill('')
  await expect.poll(readValue).toBe(0)
})

it('writes slider changes and clamps numeric input on blur', async () => {
  await renderField(<NumberSliderField label="Threshold" min={0} max={10} />, 2)
  const slider = page.getByRole('slider', { name: 'Threshold' })
  await page.getByRole('spinbutton', { name: 'Threshold' }).click()
  await userEvent.tab()
  await expect.element(slider).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(readValue).toBe(3)
  const input = page.getByRole('spinbutton', { name: 'Threshold' })
  await input.fill('')
  await input.fill('12')
  await userEvent.tab()
  await expect.poll(readValue).toBe(10)
})

it('keeps the empty selection label and writes the chosen option to the form', async () => {
  await renderField(
    <SelectField
      label="Mode"
      options={[
        { label: 'None', value: '' },
        { label: 'Beta', value: 'beta' },
      ]}
    />,
    '',
  )
  const select = page.getByRole('combobox', { name: 'Mode' })
  await expect.element(select).toHaveTextContent('None')
  await select.click()
  await page.getByRole('option', { name: 'Beta' }).click()
  await expect.element(select).toHaveTextContent('Beta')
  await expect.poll(readValue).toBe('beta')
})

it('adds, edits and removes option strings in the form', async () => {
  await renderField(<OptionsField label="Options" />, ['Existing'])
  await page.getByRole('button', { name: 'appDebug.variableConfig.addOption' }).click()
  await page.getByRole('textbox', { name: 'appDebug.variableConfig.options 2' }).fill('Added')
  await expect.poll(readValue).toEqual(['Existing', 'Added'])
  await page.getByRole('button', { name: 'common.operation.delete' }).nth(0).click()
  await expect.poll(readValue).toEqual(['Added'])
})

it('switches between custom and standard file types without losing custom extensions', async () => {
  await renderField(<FileTypesField label="Allowed files" />, {
    allowedFileTypes: ['document'],
    allowedFileExtensions: [],
  })
  const customName = 'appDebug.variableConfig.file.custom.name'
  await page.getByRole('checkbox', { name: customName }).click()
  await expect.poll(readValue).toEqual({ allowedFileTypes: ['custom'], allowedFileExtensions: [] })
  await page.getByRole('textbox', { name: customName }).fill('.csv')
  await userEvent.keyboard('{Enter}')
  await expect
    .poll(readValue)
    .toEqual({ allowedFileTypes: ['custom'], allowedFileExtensions: ['.csv'] })
  await page.getByRole('checkbox', { name: 'appDebug.variableConfig.file.image.name' }).click()
  await expect
    .poll(readValue)
    .toEqual({ allowedFileTypes: ['image'], allowedFileExtensions: ['.csv'] })
  await page.getByRole('checkbox', { name: 'appDebug.variableConfig.file.image.name' }).click()
  await expect.poll(() => readValue().allowedFileTypes).toEqual([])
})

it.each([true, false])(
  'writes input type choices and honors file support=%s',
  async (supportFile) => {
    await renderField(
      <InputTypeSelectField label="Input type" supportFile={supportFile} />,
      'text-input',
    )
    await page.getByRole('combobox', { name: 'Input type' }).click()
    for (const name of [
      /appDebug.variableConfig.single-file/,
      /appDebug.variableConfig.multi-files/,
    ]) {
      if (supportFile) await expect.element(page.getByRole('option', { name })).toBeVisible()
      else await expect.element(page.getByRole('option', { name })).not.toBeInTheDocument()
    }
    if (supportFile) {
      await page.getByRole('option', { name: /appDebug.variableConfig.single-file/ }).click()
      await expect.poll(readValue).toBe('file')
      await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
      await page.getByRole('combobox', { name: 'Input type' }).click()
      await page.getByRole('option', { name: /appDebug.variableConfig.multi-files/ }).click()
      await expect.poll(readValue).toBe('file-list')
      await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
      await page.getByRole('combobox', { name: 'Input type' }).click()
    }
    await page.getByRole('option', { name: /appDebug.variableConfig.number/ }).click()
    await expect.poll(readValue).toBe('number')
  },
)

it('removes an uploaded file from both the field and the form state', async () => {
  await renderField(
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
  await expect.element(page.getByText('report.pdf')).toBeVisible()
  await page.getByRole('button', { name: /remove|delete/i }).click()
  await expect.element(page.getByText('report.pdf')).not.toBeInTheDocument()
  await expect.poll(readValue).toEqual([])
})

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
