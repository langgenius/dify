import type { FileUpload } from '@/app/components/base/features/types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { FileContextProvider } from '../../store'
import FileUploaderInChatInput from '../index'

// Loading files belongs to the upload hook; this owner chooses the permitted sources.
vi.mock('../../hooks', () => ({
  useFile: () => ({ handleLoadFileFromLink: vi.fn(), handleLocalFileUpload: vi.fn() }),
}))

const config = (methods: TransferMethod[]): FileUpload => ({
  enabled: true,
  allowed_file_types: [SupportUploadFileTypes.image],
  allowed_file_upload_methods: methods,
  allowed_file_extensions: [],
  number_limits: 5,
})

it.each([
  { methods: [TransferMethod.local_file], local: true, remote: false },
  { methods: [TransferMethod.remote_url], local: false, remote: true },
  { methods: [TransferMethod.local_file, TransferMethod.remote_url], local: true, remote: true },
])('offers only configured upload sources: $methods', async ({ methods, local, remote }) => {
  const user = userEvent.setup()
  render(
    <FileContextProvider>
      <FileUploaderInChatInput fileConfig={config(methods)} />
    </FileContextProvider>,
  )
  await user.click(screen.getByRole('button', { name: /fileUploader\.uploadFromComputer/ }))
  const popup = await screen.findByRole('dialog')
  expect(
    within(popup).queryByRole('button', { name: /fileUploader\.uploadFromComputer/ }) !== null,
  ).toBe(local)
  expect(within(popup).queryByRole('textbox') !== null).toBe(remote)
})

it('prevents opening upload controls in readonly mode', async () => {
  const user = userEvent.setup()
  render(
    <FileContextProvider>
      <FileUploaderInChatInput
        fileConfig={config([TransferMethod.local_file, TransferMethod.remote_url])}
        readonly
      />
    </FileContextProvider>,
  )
  const trigger = screen.getByRole('button', { name: /fileUploader\.uploadFromComputer/ })
  expect(trigger).toBeDisabled()
  await user.click(trigger)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
