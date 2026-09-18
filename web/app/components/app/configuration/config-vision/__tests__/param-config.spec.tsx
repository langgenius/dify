import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeaturesProvider } from '@/app/components/base/features/context'
import { Resolution, TransferMethod } from '@/types/app'
import ParamConfig from '../param-config'

const renderConfig = () =>
  render(
    <FeaturesProvider
      features={{
        file: {
          enabled: true,
          allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
          number_limits: 3,
          image: { enabled: true, detail: Resolution.low },
        },
      }}
    >
      <ParamConfig />
    </FeaturesProvider>,
  )

describe('ParamConfig', () => {
  it('opens a named settings panel and exposes named, keyboard-operable radio groups', async () => {
    const user = userEvent.setup()
    renderConfig()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'appDebug.voice.settings' }))

    const panel = await screen.findByRole('dialog', {
      name: 'appDebug.vision.visionSettings.title',
    })
    const resolution = within(panel).getByRole('radiogroup', {
      name: 'appDebug.vision.visionSettings.resolution',
    })
    const low = within(resolution).getByRole('radio', {
      name: 'appDebug.vision.visionSettings.low',
    })
    expect(low).toBeChecked()
    await user.click(low)
    await user.keyboard('{ArrowLeft}')
    expect(
      within(resolution).getByRole('radio', { name: 'appDebug.vision.visionSettings.high' }),
    ).toBeChecked()

    const uploadMethods = within(panel).getByRole('radiogroup', {
      name: 'appDebug.vision.visionSettings.uploadMethod',
    })
    const both = within(uploadMethods).getByRole('radio', {
      name: 'appDebug.vision.visionSettings.both',
    })
    expect(both).toBeChecked()
    await user.click(both)
    await user.keyboard('{ArrowRight}')
    expect(
      within(uploadMethods).getByRole('radio', {
        name: 'appDebug.vision.visionSettings.localUpload',
      }),
    ).toBeChecked()
    await user.keyboard('{ArrowRight}')
    expect(
      within(uploadMethods).getByRole('radio', { name: 'appDebug.vision.visionSettings.url' }),
    ).toBeChecked()
  })
})
