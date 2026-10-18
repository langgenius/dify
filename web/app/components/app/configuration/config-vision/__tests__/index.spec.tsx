import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { renderWithDebugConfiguration } from '@/test/debug-configuration'
import ConfigVision from '../index'

it('omits vision settings when the model does not support them', () => {
  const store = createFeaturesStore()
  renderWithDebugConfiguration(
    <FeaturesContext.Provider value={store}>
      <ConfigVision />
    </FeaturesContext.Provider>,
    { isShowVisionConfig: false },
  )
  expect(screen.queryByRole('switch', { name: 'fileUpload.vision.name' })).not.toBeInTheDocument()
})

it.each([
  { video: false, remaining: [] },
  { video: true, remaining: [] },
  { video: false, remaining: [SupportUploadFileTypes.document] },
  { video: true, remaining: [SupportUploadFileTypes.document] },
])(
  'toggles supported vision types while preserving other uploads: %j',
  async ({ video, remaining }) => {
    const user = userEvent.setup()
    const store = createFeaturesStore({
      features: {
        file: {
          enabled: remaining.length > 0,
          allowed_file_types: remaining,
          image: { enabled: false },
        },
      },
    })
    renderWithDebugConfiguration(
      <FeaturesContext.Provider value={store}>
        <ConfigVision />
      </FeaturesContext.Provider>,
      { isShowVisionConfig: true, isAllowVideoUpload: video },
    )
    const toggle = screen.getByRole('switch', { name: 'fileUpload.vision.name' })
    await user.click(toggle)
    expect(store.getState().features.file).toMatchObject({
      enabled: true,
      image: { enabled: true },
    })
    expect(store.getState().features.file?.allowed_file_types).toEqual([
      ...remaining,
      SupportUploadFileTypes.image,
      ...(video ? [SupportUploadFileTypes.video] : []),
    ])
    expect(toggle).toBeChecked()
    await user.click(toggle)
    expect(store.getState().features.file).toMatchObject({
      enabled: remaining.length > 0,
      image: { enabled: false },
      allowed_file_types: remaining,
    })
    expect(toggle).not.toBeChecked()
  },
)
