import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { TransferMethod } from '@/types/app'
import { FeaturesContext } from '../../../context'
import { createFeaturesStore } from '../../../store'
import SettingContent from '../setting-content'

function setup({ imageUpload = false, missingFile = false, onChange = vi.fn() } = {}) {
  const store = createFeaturesStore()
  store.setState(({ features }) => ({
    features: {
      ...features,
      file: missingFile
        ? undefined
        : {
            enabled: true,
            allowed_file_upload_methods: [TransferMethod.local_file],
            allowed_file_types: ['image'],
            allowed_file_extensions: ['.jpg'],
            number_limits: 5,
          },
    },
  }))
  const onClose = vi.fn()
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  renderWithConsoleQuery(
    <FeaturesContext.Provider value={store}>
      <SettingContent imageUpload={imageUpload} onClose={onClose} onChange={onChange} />
    </FeaturesContext.Provider>,
    { queryClient },
  )
  return { store, onClose, onChange, user: userEvent.setup() }
}

it('keeps edits local until save and maps the upload limit back into the feature', async () => {
  const { store, onChange, user } = setup()
  await user.click(screen.getByRole('radio', { name: 'URL' }))
  await user.click(
    screen.getByRole('checkbox', { name: 'appDebug.variableConfig.file.document.name' }),
  )
  const limit = screen.getByRole('spinbutton', {
    name: 'appDebug.variableConfig.maxNumberOfUploads',
  })
  await user.clear(limit)
  await user.type(limit, '2')
  await user.tab()
  expect(store.getState().features.file?.number_limits).toBe(5)
  expect(onChange).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(store.getState().features.file).toEqual({
    enabled: true,
    allowed_file_upload_methods: [TransferMethod.remote_url],
    allowed_file_types: ['image', 'document'],
    allowed_file_extensions: ['.jpg'],
    number_limits: 2,
  })
  expect(onChange).toHaveBeenCalledOnce()
})

it.each(['cancel', 'close'])(
  'discards a changed draft when %s closes the editor',
  async (action) => {
    const { store, onClose, onChange, user } = setup()
    const saved = store.getState().features
    await user.click(screen.getByRole('radio', { name: 'URL' }))
    screen.getByRole('button', { name: `common.operation.${action}` }).focus()
    await user.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalledOnce()
    expect(onChange).not.toHaveBeenCalled()
    expect(store.getState().features).toBe(saved)
  },
)

it('requires at least one allowed file type before saving', async () => {
  const { onChange, user } = setup()
  await user.click(
    screen.getByRole('checkbox', { name: 'appDebug.variableConfig.file.image.name' }),
  )
  expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(onChange).not.toHaveBeenCalled()
  await user.click(
    screen.getByRole('checkbox', { name: 'appDebug.variableConfig.file.document.name' }),
  )
  expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeEnabled()
})

it('uses image defaults and hides file-type choices in image-only mode', async () => {
  const { store, user } = setup({ imageUpload: true, missingFile: true })
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'appDebug.variableConfig.both' })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(store.getState().features.file).toMatchObject({
    allowed_file_types: ['image'],
    number_limits: 3,
    allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  })
})
