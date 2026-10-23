import type { Features } from '../../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { TransferMethod } from '@/types/app'
import { FeaturesProvider } from '../../../context'
import { useFeatures } from '../../../hooks'
import FileUploadSettings from '../setting-modal'

const defaultFeatures: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: false },
  speech2text: { enabled: false },
  citation: { enabled: false },
  moderation: { enabled: false },
  file: {
    enabled: true,
    allowed_file_upload_methods: [TransferMethod.local_file],
    allowed_file_types: ['image'],
    allowed_file_extensions: ['.jpg'],
    number_limits: 5,
  },
  annotationReply: { enabled: false },
}

function Harness({ onChange, disabled = false }: { onChange: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const limit = useFeatures((state) => state.features.file?.number_limits)
  return (
    <>
      <output aria-label="Saved file limit">{limit}</output>
      <FileUploadSettings open={open} onOpen={setOpen} onChange={onChange} disabled={disabled}>
        <button type="button">Upload Settings</button>
      </FileUploadSettings>
    </>
  )
}
function setup(disabled = false) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  const onChange = vi.fn()
  renderWithConsoleQuery(
    <FeaturesProvider features={defaultFeatures}>
      <Harness onChange={onChange} disabled={disabled} />
    </FeaturesProvider>,
    { queryClient },
  )
  return onChange
}

it('discards cancelled edits and saves the next edit to feature state before closing', async () => {
  const user = userEvent.setup()
  const onChange = setup()
  await user.click(screen.getByRole('button', { name: 'Upload Settings' }))
  const input = screen.getByRole('spinbutton', {
    name: 'appDebug.variableConfig.maxNumberOfUploads',
  })
  await user.clear(input)
  await user.type(input, '6')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument())
  expect(screen.getByLabelText('Saved file limit')).toHaveTextContent('5')
  expect(onChange).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Upload Settings' }))
  const reopened = screen.getByRole('spinbutton', {
    name: 'appDebug.variableConfig.maxNumberOfUploads',
  })
  expect(reopened).toHaveValue(5)
  await user.clear(reopened)
  await user.type(reopened, '6')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument())
  expect(screen.getByLabelText('Saved file limit')).toHaveTextContent('6')
  expect(onChange).toHaveBeenCalledOnce()
})

it('keeps settings closed when editing is disabled', async () => {
  const user = userEvent.setup()
  const onChange = setup(true)
  await user.click(screen.getByRole('button', { name: 'Upload Settings' }))
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
})
