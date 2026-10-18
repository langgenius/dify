import type { ComponentProps } from 'react'
import type { FileEntity } from '../../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { FileContextProvider } from '../../store'
import FileFromLinkOrLocal from '../index'

const uploadRemoteFileInfo = vi.hoisted(() => vi.fn())
vi.mock('@/service/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/common')>()),
  uploadRemoteFileInfo,
}))
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/apps' }))

const config: FileUpload = {
  enabled: true,
  allowed_file_types: [SupportUploadFileTypes.document],
  allowed_file_extensions: [],
  number_limits: 1,
}
const setup = async (
  props: Partial<ComponentProps<typeof FileFromLinkOrLocal>> = {},
  files: FileEntity[] = [],
) => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <FileContextProvider value={files} onChange={onChange}>
      <FileFromLinkOrLocal
        fileConfig={config}
        trigger={(triggerProps, state) => (
          <button {...triggerProps}>{state.open ? 'Close uploads' : 'Open uploads'}</button>
        )}
        {...props}
      />
    </FileContextProvider>,
  )
  await user.click(screen.getByRole('button', { name: 'Open uploads' }))
  return { user, onChange }
}

beforeEach(() => {
  uploadRemoteFileInfo.mockReset()
  uploadRemoteFileInfo.mockResolvedValue({
    id: 'uploaded-file',
    name: 'report.pdf',
    mime_type: 'application/pdf',
    size: 10,
    url: 'https://example.com/report.pdf',
  })
})

it.each([
  { showFromLink: true, showFromLocal: false },
  { showFromLink: false, showFromLocal: true },
  { showFromLink: true, showFromLocal: true },
])('offers configured upload methods: %o', async (props) => {
  await setup(props)
  expect(!!screen.queryByPlaceholderText(/pasteFileLinkInputPlaceholder/)).toBe(props.showFromLink)
  expect(!!screen.queryByRole('button', { name: /uploadFromComputer/ })).toBe(props.showFromLocal)
})

it('rejects an invalid link, clears the error on editing, and persists a valid upload', async () => {
  const { user, onChange } = await setup()
  const input = screen.getByPlaceholderText(/pasteFileLinkInputPlaceholder/)
  const submit = screen.getByRole('button', { name: 'common.operation.ok' })
  expect(submit).toBeDisabled()
  await user.type(input, 'invalid-url')
  await user.click(submit)
  expect(screen.getByText(/pasteFileLinkInvalid/)).toBeInTheDocument()
  expect(uploadRemoteFileInfo).not.toHaveBeenCalled()
  await user.clear(input)
  await user.type(input, 'https://example.com/report.pdf')
  expect(screen.queryByText(/pasteFileLinkInvalid/)).not.toBeInTheDocument()
  await user.click(submit)
  expect(uploadRemoteFileInfo).toHaveBeenCalledWith('https://example.com/report.pdf', false)
  await waitFor(() =>
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        uploadedId: 'uploaded-file',
        progress: 100,
        transferMethod: TransferMethod.remote_url,
      }),
    ]),
  )
  expect(input).toHaveValue('')
  expect(input).toBeDisabled()
  expect(screen.getByRole('button', { name: /uploadFromComputer/ })).toBeDisabled()
})

it('dismisses the upload popover through its trigger', async () => {
  const { user } = await setup()
  await user.click(screen.getByRole('button', { name: 'Close uploads' }))
  await waitFor(() =>
    expect(screen.queryByPlaceholderText(/pasteFileLinkInputPlaceholder/)).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('button', { name: 'Open uploads' })).toBeInTheDocument()
})
