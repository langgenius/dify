import type { Features } from '../../../types'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { TtsAutoPlay } from '@/types/app'
import { FeaturesProvider } from '../../../context'
import TextToSpeech from '../index'

vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))
// Audio playback is owned by AudioBtn; this suite exercises feature configuration.
vi.mock('@/app/components/base/audio-btn', () => ({ AudioBtn: () => null }))

const renderFeature = (
  text2speech: Features['text2speech'] = { enabled: false },
  disabled = false,
  onChange?: () => void,
) =>
  render(
    <FeaturesProvider features={{ text2speech }}>
      <TextToSpeech disabled={disabled} onChange={onChange} />
    </FeaturesProvider>,
  )

describe('TextToSpeech', () => {
  it('updates the feature store and retains voice preferences across disable and enable', async () => {
    const user = userEvent.setup({ skipHover: true })
    const onChange = vi.fn()
    renderFeature(
      { enabled: true, language: 'en-US', voice: 'alloy', autoPlay: TtsAutoPlay.enabled },
      false,
      onChange,
    )
    expect(screen.getByText('alloy')).toBeInTheDocument()
    expect(screen.getByText(/voice.voiceSettings.autoPlayEnabled/)).toBeInTheDocument()
    await user.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(screen.getByText(/feature.textToSpeech.description/)).toBeInTheDocument()
    await user.click(screen.getByRole('switch'))
    await user.unhover(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toBeChecked()
    expect(screen.getByText('alloy')).toBeInTheDocument()
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('opens real voice settings and persists autoplay changes', async () => {
    const user = userEvent.setup({ skipHover: true })
    renderFeature({ enabled: true, language: 'en-US' })
    expect(screen.getByText(/voice.defaultDisplay/)).toBeInTheDocument()
    await user.hover(screen.getByText(/feature.textToSpeech.title/))
    await user.click(screen.getByRole('button', { name: /voice.voiceSettings.title/ }))
    const dialog = await screen.findByRole('dialog')
    const switches = screen.getAllByRole('switch')
    await user.click(switches.find((item) => dialog.contains(item))!)
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await user.hover(screen.getByText(/feature.textToSpeech.title/))
    await user.click(screen.getByRole('button', { name: /voice.voiceSettings.title/ }))
    expect(within(await screen.findByRole('dialog')).getByRole('switch')).toBeChecked()
  })

  it('prevents toggling or opening voice settings when disabled', async () => {
    const user = userEvent.setup({ skipHover: true })
    const onChange = vi.fn()
    renderFeature({ enabled: true, language: 'en-US' }, true, onChange)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    await user.hover(screen.getByText(/feature.textToSpeech.title/))
    const settings = screen.getByRole('button', { name: /voice.voiceSettings.title/ })
    expect(settings).toBeDisabled()
    await user.click(settings)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
