import type { HumanInputFieldValue } from '../field-renderer'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { FakeApiHandle, FakeRoute } from '@/test/fake-api'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { installFakeApi, route } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { TransferMethod } from '@/types/app'
import HumanInputFieldRenderer from '../field-renderer'

const fileField = {
  output_variable_name: 'attachments',
  allowed_file_extensions: ['.pdf'],
  allowed_file_types: [SupportUploadFileTypes.document],
  allowed_file_upload_methods: [TransferMethod.local_file],
}

const existingFile = (index: number): FileEntity => ({
  id: `file-${index}`,
  name: `report-${index}.pdf`,
  size: 1,
  type: 'application/pdf',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
})

function savedValue(value: HumanInputFieldValue) {
  if (Array.isArray(value)) return value.map((file) => file.name).join(',')
  if (value && typeof value !== 'string')
    return `${value.name}:${value.uploadedId ?? ''}:${value.progress}`
  return value ?? 'empty'
}

function Field({
  field,
  initialValue = null,
}: {
  field: FormInputItem
  initialValue?: HumanInputFieldValue
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <>
      <HumanInputFieldRenderer field={field} value={value} onChange={setValue} />
      <output aria-label={`${field.output_variable_name} saved value`}>{savedValue(value)}</output>
    </>
  )
}

async function renderField(field: FormInputItem, initialValue?: HumanInputFieldValue) {
  const { wrapper: Query } = createConsoleQueryWrapper()
  const { NavigationProvider } = createTestNavigation({ url: '/chat' })
  await render(
    <NavigationProvider>
      <Query>
        <Field field={field} initialValue={initialValue} />
      </Query>
    </NavigationProvider>,
  )
}

const uploadedFile = (body: unknown) => (body as FormData).get('file') as File
let fake: FakeApiHandle<{ routes: FakeRoute[] }>

beforeEach(() => {
  fake = installFakeApi({
    routes: [
      route('POST', 'console', '/files/upload', ({ body }) => ({
        id: `uploaded-${uploadedFile(body).name}`,
      })),
    ],
  })
  onTestFinished(fake)
})

it('retains the complete paragraph value in its controlled owner', async () => {
  await renderField(
    {
      type: InputVarType.paragraph,
      output_variable_name: 'summary',
      default: { type: 'constant', selector: [], value: '' },
    },
    'hello',
  )

  const paragraph = page.getByRole('textbox', { name: 'summary' })
  await paragraph.fill('hello world')
  await expect.element(paragraph).toHaveValue('hello world')
  await expect
    .element(page.getByRole('status', { name: 'summary saved value' }))
    .toHaveTextContent('hello world')
})

it('commits a keyboard-selected reviewer to its controlled owner', async () => {
  await renderField({
    type: InputVarType.select,
    output_variable_name: 'reviewer',
    option_source: { type: 'constant', selector: [], value: ['alice', 'bob'] },
  })
  const reviewer = page.getByRole('combobox', { name: 'reviewer' })
  await reviewer.click()
  await expect.element(page.getByRole('option', { name: 'alice' })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await userEvent.keyboard('{Enter}')
  await expect.element(reviewer).toHaveTextContent('alice')
  await expect
    .element(page.getByRole('status', { name: 'reviewer saved value' }))
    .toHaveTextContent('alice')
})

it('publishes one uploaded file as a scalar, enforces its limit, and clears it to null', async () => {
  await renderField({ ...fileField, type: InputVarType.singleFile })
  const uploadButton = page.getByRole('button', { name: /fileUploader\.uploadFromComputer/ })
  const input = page.elementLocator(uploadButton.element().querySelector('input[type="file"]')!)

  await input.upload(new File(['report'], 'report.pdf', { type: 'application/pdf' }))

  await expect.element(page.getByText('report.pdf')).toBeVisible()
  await expect.element(page.getByRole('progressbar')).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'attachments saved value' }))
    .toHaveTextContent('report.pdf:uploaded-report.pdf:100')
  await expect.element(uploadButton).toBeDisabled()
  expect(
    fake
      .route('POST', 'console', '/files/upload')
      .mock.calls.map(([{ body }]) => uploadedFile(body).name),
  ).toEqual(['report.pdf'])

  await page.getByRole('button', { name: 'common.operation.remove report.pdf' }).click()
  await expect.element(page.getByText('report.pdf')).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'attachments saved value' }))
    .toHaveTextContent('empty')
  await expect.element(uploadButton).toBeEnabled()
})

it('removes one item from a full file list and makes the native picker available again', async () => {
  const files = Array.from({ length: 3 }, (_, index) => existingFile(index))
  await renderField({ ...fileField, type: InputVarType.multiFiles, number_limits: 3 }, files)

  const uploadButton = page.getByRole('button', { name: /fileUploader\.uploadFromComputer/ })
  await expect.element(uploadButton).toBeDisabled()
  await page.getByRole('button', { name: 'common.operation.remove report-0.pdf' }).click()

  await expect.element(page.getByText('report-0.pdf')).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'attachments saved value' }))
    .toHaveTextContent('report-1.pdf,report-2.pdf')
  await expect.element(uploadButton).toBeEnabled()
})
