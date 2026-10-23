import type { HumanInputFieldValue } from '../field-renderer'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { fileUpload } from '@/app/components/base/file-uploader/utils'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { TransferMethod } from '@/types/app'
import HumanInputFieldRenderer from '../field-renderer'

vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/' }))
vi.mock('@/app/components/base/file-uploader/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/file-uploader/utils')>()),
  fileUpload: vi.fn(),
}))

const uploadResponse = (file: File) => ({
  id: `uploaded-${file.name}`,
  name: file.name,
  size: file.size,
  mime_type: file.type,
  extension: 'pdf',
  created_at: 1,
  created_by: 'user-1',
  preview_url: null,
  source_url: '',
})
const existingFile = (index: number): FileEntity => ({
  id: `file-${index}`,
  name: `report-${index}.pdf`,
  size: 1,
  type: 'application/pdf',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
})
const fileFields = {
  output_variable_name: 'attachments',
  allowed_file_extensions: ['.pdf'],
  allowed_file_types: [SupportUploadFileTypes.document],
  allowed_file_upload_methods: [TransferMethod.local_file],
}
function Field({
  field,
  initialValue = null,
  onChange,
}: {
  field: FormInputItem
  initialValue?: HumanInputFieldValue
  onChange: (value: HumanInputFieldValue) => void
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <HumanInputFieldRenderer
      field={field}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fileUpload).mockImplementation(({ file, onSuccessCallback }) =>
    onSuccessCallback(uploadResponse(file)),
  )
})

it('edits a paragraph through its accessible field and retains the complete value', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <Field
      field={{
        type: InputVarType.paragraph,
        output_variable_name: 'summary',
        default: { type: 'constant', selector: [], value: '' },
      }}
      initialValue="hello"
      onChange={onChange}
    />,
  )
  const input = screen.getByRole('textbox', { name: 'summary' })
  await user.type(input, ' world')
  expect(input).toHaveValue('hello world')
  expect(onChange).toHaveBeenLastCalledWith('hello world')
})

it('selects a configured reviewer from the real popup', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <Field
      field={{
        type: InputVarType.select,
        output_variable_name: 'reviewer',
        option_source: { type: 'constant', selector: [], value: ['alice', 'bob'] },
      }}
      onChange={onChange}
    />,
  )
  await user.click(screen.getByRole('combobox', { name: 'reviewer' }))
  await user.click(await screen.findByRole('option', { name: 'alice' }))
  expect(onChange).toHaveBeenLastCalledWith('alice')
  expect(screen.getByRole('combobox', { name: 'reviewer' })).toHaveTextContent('alice')
})

it('uploads one file as a scalar, enforces the single-file limit, and clears it to null', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const { container } = render(
    <Field field={{ ...fileFields, type: InputVarType.singleFile }} onChange={onChange} />,
  )
  const file = new File(['report'], 'report.pdf', { type: 'application/pdf' })
  await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file)
  await waitFor(() =>
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'report.pdf',
        uploadedId: 'uploaded-report.pdf',
        progress: 100,
      }),
    ),
  )
  expect(screen.getByRole('button', { name: /fileUploader.uploadFromComputer/ })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'common.operation.remove report.pdf' }))
  expect(onChange).toHaveBeenLastCalledWith(null)
  expect(screen.getByRole('button', { name: /fileUploader.uploadFromComputer/ })).toBeEnabled()
})

it.each([3, undefined])(
  'enforces a file-list limit of %s and emits the remaining array after removal',
  async (numberLimits) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const files = Array.from({ length: numberLimits ?? 5 }, (_, index) => existingFile(index))
    render(
      <Field
        field={{ ...fileFields, type: InputVarType.multiFiles, number_limits: numberLimits }}
        initialValue={files}
        onChange={onChange}
      />,
    )
    const uploadButton = screen.getByRole('button', { name: /fileUploader.uploadFromComputer/ })
    expect(uploadButton).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'common.operation.remove report-0.pdf' }))
    expect(onChange).toHaveBeenLastCalledWith(files.slice(1))
    expect(screen.queryByText('report-0.pdf')).not.toBeInTheDocument()
    expect(uploadButton).toBeEnabled()
  },
)
