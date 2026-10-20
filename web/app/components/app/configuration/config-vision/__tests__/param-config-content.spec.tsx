import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { Resolution, TransferMethod } from '@/types/app'
import ParamConfigContent from '../param-config-content'

it('preserves the other vision settings when changing resolution, upload method and limit', async () => {
  const user = userEvent.setup()
  const store = createFeaturesStore({
    features: {
      file: {
        enabled: true,
        allowed_file_types: ['image'],
        allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
        number_limits: 3,
        image: { enabled: true, detail: Resolution.low },
      },
    },
  })
  render(
    <FeaturesContext.Provider value={store}>
      <ParamConfigContent />
    </FeaturesContext.Provider>,
  )
  await user.click(screen.getByRole('radio', { name: 'fileUpload.vision.visionSettings.high' }))
  await user.click(
    screen.getByRole('radio', { name: 'fileUpload.vision.visionSettings.localUpload' }),
  )
  const limit = screen.getByRole('textbox', {
    name: 'fileUpload.vision.visionSettings.uploadLimit',
  })
  await user.clear(limit)
  await user.type(limit, '5')
  await user.tab()
  expect(store.getState().features.file).toEqual({
    enabled: true,
    allowed_file_types: ['image'],
    allowed_file_upload_methods: [TransferMethod.local_file],
    number_limits: 5,
    image: {
      enabled: true,
      detail: Resolution.high,
      transfer_methods: [TransferMethod.local_file],
      number_limits: 5,
    },
  })
})
