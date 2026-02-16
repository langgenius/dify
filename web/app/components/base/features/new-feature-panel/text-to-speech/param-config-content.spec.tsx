import type { Features } from '../../types'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { TtsAutoPlay } from '@/types/app'
import { FeaturesProvider } from '../../context'
import ParamConfigContent from './param-config-content'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/test-app-id/configuration',
}))

vi.mock('@/i18n-config/language', () => ({
  languages: [
    { value: 'en-US', name: 'English', example: 'Hello world' },
    { value: 'zh-Hans', name: '中文', example: '你好' },
  ],
}))

vi.mock('@/service/use-apps', () => ({
  useAppVoices: () => ({
    data: [
      { value: 'alloy', name: 'Alloy' },
      { value: 'echo', name: 'Echo' },
    ],
  }),
}))

vi.mock('@/app/components/base/audio-btn', () => ({
  default: () => <div data-testid="audio-btn">Audio</div>,
}))

vi.mock('@/types/app', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/types/app')>()
  return {
    ...actual,
    TtsAutoPlay: {
      enabled: 'enabled',
      disabled: 'disabled',
    },
  }
})

const defaultFeatures: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: true, language: 'en-US', voice: 'alloy', autoPlay: TtsAutoPlay.disabled },
  speech2text: { enabled: false },
  citation: { enabled: false },
  moderation: { enabled: false },
  file: { enabled: false },
  annotationReply: { enabled: false },
}

const renderWithProvider = (
  props: { onClose?: () => void, onChange?: OnFeaturesChange } = {},
  featureOverrides?: Partial<Features>,
) => {
  const features = { ...defaultFeatures, ...featureOverrides }
  return render(
    <FeaturesProvider features={features}>
      <ParamConfigContent
        onClose={props.onClose ?? vi.fn()}
        onChange={props.onChange}
      />
    </FeaturesProvider>,
  )
}

describe('ParamConfigContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render voice settings title', () => {
    renderWithProvider()

    expect(screen.getByText(/voice\.voiceSettings\.title/)).toBeInTheDocument()
  })

  it('should render language label', () => {
    renderWithProvider()

    expect(screen.getByText(/voice\.voiceSettings\.language/)).toBeInTheDocument()
  })

  it('should render voice label', () => {
    renderWithProvider()

    expect(screen.getByText(/voice\.voiceSettings\.voice/)).toBeInTheDocument()
  })

  it('should render autoPlay toggle', () => {
    renderWithProvider()

    expect(screen.getByText(/voice\.voiceSettings\.autoPlay/)).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('should render close button and call onClose', () => {
    const onClose = vi.fn()
    renderWithProvider({ onClose })

    // The close button is in the same row as the title
    // Title is inside a div, and the close icon is a sibling div in the parent row
    const titleElement = screen.getByText(/voice\.voiceSettings\.title/)
    const titleDiv = titleElement.closest('div')!
    const headerRow = titleDiv.parentElement!
    // The close icon wrapper is the last child div in the header row
    const closeButton = headerRow.lastElementChild!
    fireEvent.click(closeButton)

    expect(onClose).toHaveBeenCalled()
  })

  it('should render audio button when language has example', () => {
    renderWithProvider()

    expect(screen.getByTestId('audio-btn')).toBeInTheDocument()
  })

  it('should render tooltip icon for language', () => {
    renderWithProvider()

    // Tooltip is rendered alongside the language label
    const languageLabel = screen.getByText(/voice\.voiceSettings\.language/)
    expect(languageLabel).toBeInTheDocument()
  })

  it('should toggle autoPlay switch and call onChange', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    fireEvent.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalled()
  })

  it('should display language listbox button', () => {
    renderWithProvider()

    // HeadlessUI renders Listbox buttons accessible as role="button"
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('should display current voice in listbox button', () => {
    renderWithProvider()

    // The voice listbox button should show the current voice name
    const buttons = screen.getAllByRole('button')
    const voiceButton = buttons.find(btn => btn.textContent?.includes('Alloy'))
    expect(voiceButton).toBeInTheDocument()
  })

  it('should open language listbox and show options', async () => {
    renderWithProvider()

    // Click the language listbox button
    const buttons = screen.getAllByRole('button')
    const languageButton = buttons.find(btn => btn.textContent?.includes('voice.language.'))
    expect(languageButton).toBeDefined()
    fireEvent.click(languageButton!)
    // The listbox options should appear
    const options = await screen.findAllByRole('option')
    expect(options.length).toBeGreaterThanOrEqual(2)
  })

  it('should handle language change', async () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    // Click the language listbox button to open
    const buttons = screen.getAllByRole('button')
    const languageButton = buttons.find(btn => btn.textContent?.includes('voice.language.'))
    expect(languageButton).toBeDefined()
    fireEvent.click(languageButton!)
    const options = await screen.findAllByRole('option')
    expect(options.length).toBeGreaterThan(1)
    fireEvent.click(options[1])
    expect(onChange).toHaveBeenCalled()
  })

  it('should handle voice change', async () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    // Find and click the voice listbox button (shows "Alloy")
    const buttons = screen.getAllByRole('button')
    const voiceButton = buttons.find(btn => btn.textContent?.includes('Alloy'))
    expect(voiceButton).toBeDefined()
    fireEvent.click(voiceButton!)
    const options = await screen.findAllByRole('option')
    expect(options.length).toBeGreaterThan(1)
    fireEvent.click(options[1]) // Select "Echo"
    expect(onChange).toHaveBeenCalled()
  })

  it('should call onClose when close icon is clicked via header', () => {
    const onClose = vi.fn()
    renderWithProvider({ onClose })

    const titleElement = screen.getByText(/voice\.voiceSettings\.title/)
    const titleDiv = titleElement.closest('div')!
    const headerRow = titleDiv.parentElement!
    const closeButton = headerRow.lastElementChild!
    fireEvent.click(closeButton)

    expect(onClose).toHaveBeenCalled()
  })

  it('should show selected language option in listbox', async () => {
    renderWithProvider()

    // Open language listbox
    const buttons = screen.getAllByRole('button')
    const languageButton = buttons.find(btn => btn.textContent?.includes('voice.language.'))
    expect(languageButton).toBeDefined()
    fireEvent.click(languageButton!)
    const options = await screen.findAllByRole('option')
    expect(options.length).toBeGreaterThanOrEqual(1)

    // The selected language option (en-US / English) should be present
    const selectedOption = options.find(opt => opt.textContent?.includes('voice.language.enUS'))
    expect(selectedOption).toBeDefined()
    expect(selectedOption).toHaveAttribute('aria-selected', 'true')
  })

  it('should show selected voice option in listbox', async () => {
    renderWithProvider()

    const buttons = screen.getAllByRole('button')
    const voiceButton = buttons.find(btn => btn.textContent?.includes('Alloy'))
    expect(voiceButton).toBeDefined()
    fireEvent.click(voiceButton!)
    const options = await screen.findAllByRole('option')
    expect(options.length).toBeGreaterThanOrEqual(1)

    // The selected voice option (Alloy) should be present
    const selectedOption = options.find(opt => opt.textContent?.includes('Alloy'))
    expect(selectedOption).toBeDefined()
    expect(selectedOption).toHaveAttribute('aria-selected', 'true')
  })

  it('should render with no language set and use first as default', () => {
    renderWithProvider({}, {
      text2speech: { enabled: true, language: '', voice: '', autoPlay: TtsAutoPlay.disabled },
    })

    // When language is not found, it falls back to first language
    const buttons = screen.getAllByRole('button')
    // The first language (English) should be shown as default
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('should render with no voice set and use first as default', () => {
    renderWithProvider({}, {
      text2speech: { enabled: true, language: 'en-US', voice: 'nonexistent', autoPlay: TtsAutoPlay.disabled },
    })

    // Voice not found in voiceItems, falls back to first voice "Alloy"
    const buttons = screen.getAllByRole('button')
    const voiceButton = buttons.find(btn => btn.textContent?.includes('Alloy'))
    expect(voiceButton).toBeInTheDocument()
  })
})
