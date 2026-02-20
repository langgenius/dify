import type { Features } from '../../types'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { TtsAutoPlay } from '@/types/app'
import { FeaturesProvider } from '../../context'
import TextToSpeech from './index'

vi.mock('@/i18n-config/language', () => ({
  languages: [
    { value: 'en-US', name: 'English', example: 'Hello world' },
    { value: 'zh-Hans', name: '中文', example: '你好' },
  ],
}))

const defaultFeatures: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: false },
  speech2text: { enabled: false },
  citation: { enabled: false },
  moderation: { enabled: false },
  file: { enabled: false },
  annotationReply: { enabled: false },
}

const renderWithProvider = (
  props: { disabled?: boolean, onChange?: OnFeaturesChange } = {},
  featureOverrides?: Partial<Features>,
) => {
  const features = { ...defaultFeatures, ...featureOverrides }
  return render(
    <FeaturesProvider features={features}>
      <TextToSpeech disabled={props.disabled ?? false} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

describe('TextToSpeech', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the text-to-speech title', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.textToSpeech\.title/)).toBeInTheDocument()
  })

  it('should render description when disabled', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.textToSpeech\.description/)).toBeInTheDocument()
  })

  it('should render a switch toggle', () => {
    renderWithProvider()

    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('should call onChange when toggled', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    fireEvent.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalled()
  })

  it('should show language and voice info when enabled and not hovering', () => {
    renderWithProvider({}, {
      text2speech: { enabled: true, language: 'en-US', voice: 'alloy' },
    })

    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('alloy')).toBeInTheDocument()
  })

  it('should show default display text when voice is not set', () => {
    renderWithProvider({}, {
      text2speech: { enabled: true, language: 'en-US' },
    })

    expect(screen.getByText(/voice\.defaultDisplay/)).toBeInTheDocument()
  })

  it('should show voice settings button when hovering', () => {
    renderWithProvider({}, {
      text2speech: { enabled: true },
    })

    // Simulate mouse enter on the feature card
    const card = screen.getByText(/feature\.textToSpeech\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    expect(screen.getByText(/voice\.voiceSettings\.title/)).toBeInTheDocument()
  })

  it('should show autoPlay enabled text when autoPlay is enabled', () => {
    renderWithProvider({}, {
      text2speech: { enabled: true, language: 'en-US', autoPlay: TtsAutoPlay.enabled },
    })

    expect(screen.getByText(/voice\.voiceSettings\.autoPlayEnabled/)).toBeInTheDocument()
  })

  it('should show autoPlay disabled text when autoPlay is not enabled', () => {
    renderWithProvider({}, {
      text2speech: { enabled: true, language: 'en-US' },
    })

    expect(screen.getByText(/voice\.voiceSettings\.autoPlayDisabled/)).toBeInTheDocument()
  })
})
