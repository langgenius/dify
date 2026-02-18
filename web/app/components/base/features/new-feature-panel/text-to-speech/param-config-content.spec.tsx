import type { Features } from '../../types'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TtsAutoPlay } from '@/types/app'
import { FeaturesProvider } from '../../context'
import ParamConfigContent from './param-config-content'

let mockLanguages = [
  { value: 'en-US', name: 'English', example: 'Hello world' },
  { value: 'zh-Hans', name: '中文', example: '你好' },
]

let mockPathname = '/app/test-app-id/configuration'

let mockVoiceItems: { value: string, name: string }[] | undefined = [
  { value: 'alloy', name: 'Alloy' },
  { value: 'echo', name: 'Echo' },
]

const mockUseAppVoices = vi.fn((_appId: string, _language?: string) => ({
  data: mockVoiceItems,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useParams: () => ({}),
}))

vi.mock('@/i18n-config/language', () => ({
  get languages() {
    return mockLanguages
  },
}))

vi.mock('@/service/use-apps', () => ({
  useAppVoices: (appId: string, language?: string) => mockUseAppVoices(appId, language),
}))

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
    mockPathname = '/app/test-app-id/configuration'
    mockLanguages = [
      { value: 'en-US', name: 'English', example: 'Hello world' },
      { value: 'zh-Hans', name: '中文', example: '你好' },
    ]
    mockVoiceItems = [
      { value: 'alloy', name: 'Alloy' },
      { value: 'echo', name: 'Echo' },
    ]
  })

  // Rendering states and static UI sections.
  describe('Rendering', () => {
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

    it('should render tooltip icon for language', () => {
      renderWithProvider()

      const languageLabel = screen.getByText(/voice\.voiceSettings\.language/)
      expect(languageLabel).toBeInTheDocument()
      const tooltip = languageLabel.parentElement as HTMLElement
      expect(tooltip.querySelector('svg')).toBeInTheDocument()
    })

    it('should display language listbox button', () => {
      renderWithProvider()

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })

    it('should display current voice in listbox button', () => {
      renderWithProvider()

      const buttons = screen.getAllByRole('button')
      const voiceButton = buttons.find(btn => btn.textContent?.includes('Alloy'))
      expect(voiceButton).toBeInTheDocument()
    })

    it('should render audition button when language has example', () => {
      renderWithProvider()

      const auditionButton = screen.queryByTestId('audition-button')
      expect(auditionButton).toBeInTheDocument()
    })

    it('should not render audition button when language has no example', () => {
      mockLanguages = [
        { value: 'en-US', name: 'English', example: '' },
        { value: 'zh-Hans', name: '中文', example: '' },
      ]

      renderWithProvider()

      const auditionButton = screen.queryByTestId('audition-button')
      expect(auditionButton).toBeNull()
    })

    it('should render with no language set and use first as default', () => {
      renderWithProvider({}, {
        text2speech: { enabled: true, language: '', voice: '', autoPlay: TtsAutoPlay.disabled },
      })

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should render with no voice set and use first as default', () => {
      renderWithProvider({}, {
        text2speech: { enabled: true, language: 'en-US', voice: 'nonexistent', autoPlay: TtsAutoPlay.disabled },
      })

      const buttons = screen.getAllByRole('button')
      const voiceButton = buttons.find(btn => btn.textContent?.includes('Alloy'))
      expect(voiceButton).toBeInTheDocument()
    })
  })

  // User-triggered behavior and callbacks.
  describe('User Interactions', () => {
    it('should call onClose when close button is clicked', async () => {
      const onClose = vi.fn()
      renderWithProvider({ onClose })

      const closeButton = screen.getByRole('button', { name: /close/i })
      await userEvent.click(closeButton)

      expect(onClose).toHaveBeenCalled()
    })

    it('should call onClose when close button receives Enter key', async () => {
      const onClose = vi.fn()
      renderWithProvider({ onClose })

      const closeButton = screen.getByRole('button', { name: /close/i })
      await userEvent.click(closeButton)
      onClose.mockClear()
      closeButton.focus()
      await userEvent.keyboard('{Enter}')

      expect(onClose).toHaveBeenCalled()
    })

    it('should not call onClose when close button receives unrelated key', async () => {
      const onClose = vi.fn()
      renderWithProvider({ onClose })

      const closeButton = screen.getByRole('button', { name: /close/i })
      closeButton.focus()
      await userEvent.keyboard('{Escape}')

      expect(onClose).not.toHaveBeenCalled()
    })

    it('should toggle autoPlay switch and call onChange', async () => {
      const onChange = vi.fn()
      renderWithProvider({ onChange })

      await userEvent.click(screen.getByRole('switch'))

      expect(onChange).toHaveBeenCalled()
    })

    it('should set autoPlay to disabled when toggled off from enabled state', async () => {
      const onChange = vi.fn()
      renderWithProvider(
        { onChange },
        { text2speech: { enabled: true, language: 'en-US', voice: 'alloy', autoPlay: TtsAutoPlay.enabled } },
      )

      const autoPlaySwitch = screen.getByRole('switch')
      expect(autoPlaySwitch).toHaveAttribute('aria-checked', 'true')

      await userEvent.click(autoPlaySwitch)

      expect(autoPlaySwitch).toHaveAttribute('aria-checked', 'false')
      expect(onChange).toHaveBeenCalled()
    })

    it('should call feature update without onChange callback', async () => {
      renderWithProvider()

      await userEvent.click(screen.getByRole('switch'))

      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('should open language listbox and show options', async () => {
      renderWithProvider()

      const buttons = screen.getAllByRole('button')
      const languageButton = buttons.find(btn => btn.textContent?.includes('voice.language.'))
      expect(languageButton).toBeDefined()
      await userEvent.click(languageButton!)

      const options = await screen.findAllByRole('option')
      expect(options.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle language change', async () => {
      const onChange = vi.fn()
      renderWithProvider({ onChange })

      const buttons = screen.getAllByRole('button')
      const languageButton = buttons.find(btn => btn.textContent?.includes('voice.language.'))
      expect(languageButton).toBeDefined()
      await userEvent.click(languageButton!)
      const options = await screen.findAllByRole('option')
      expect(options.length).toBeGreaterThan(1)
      await userEvent.click(options[1])
      expect(onChange).toHaveBeenCalled()
    })

    it('should handle voice change', async () => {
      const onChange = vi.fn()
      renderWithProvider({ onChange })

      const buttons = screen.getAllByRole('button')
      const voiceButton = buttons.find(btn => btn.textContent?.includes('Alloy'))
      expect(voiceButton).toBeDefined()
      await userEvent.click(voiceButton!)
      const options = await screen.findAllByRole('option')
      expect(options.length).toBeGreaterThan(1)
      await userEvent.click(options[1])
      expect(onChange).toHaveBeenCalled()
    })

    it('should show selected language option in listbox', async () => {
      renderWithProvider()

      const buttons = screen.getAllByRole('button')
      const languageButton = buttons.find(btn => btn.textContent?.includes('voice.language.'))
      expect(languageButton).toBeDefined()
      await userEvent.click(languageButton!)
      const options = await screen.findAllByRole('option')
      expect(options.length).toBeGreaterThanOrEqual(1)

      const selectedOption = options.find(opt => opt.textContent?.includes('voice.language.enUS'))
      expect(selectedOption).toBeDefined()
      expect(selectedOption).toHaveAttribute('aria-selected', 'true')
    })

    it('should show selected voice option in listbox', async () => {
      renderWithProvider()

      const buttons = screen.getAllByRole('button')
      const voiceButton = buttons.find(btn => btn.textContent?.includes('Alloy'))
      expect(voiceButton).toBeDefined()
      await userEvent.click(voiceButton!)
      const options = await screen.findAllByRole('option')
      expect(options.length).toBeGreaterThanOrEqual(1)

      const selectedOption = options.find(opt => opt.textContent?.includes('Alloy'))
      expect(selectedOption).toBeDefined()
      expect(selectedOption).toHaveAttribute('aria-selected', 'true')
    })
  })

  // Fallback and boundary scenarios.
  describe('Edge Cases', () => {
    it('should show placeholder and disable voice selection when no languages are available', () => {
      mockLanguages = []
      mockVoiceItems = undefined

      renderWithProvider({}, {
        text2speech: { enabled: true, language: 'en-US', voice: 'alloy', autoPlay: TtsAutoPlay.disabled },
      })

      const placeholderTexts = screen.getAllByText(/placeholder\.select/)
      expect(placeholderTexts.length).toBeGreaterThanOrEqual(2)

      const disabledButtons = screen
        .getAllByRole('button')
        .filter(button => button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true')

      expect(disabledButtons.length).toBeGreaterThanOrEqual(1)
    })

    it('should call useAppVoices with empty appId when pathname has no app segment', () => {
      mockPathname = '/configuration'

      renderWithProvider()

      expect(mockUseAppVoices).toHaveBeenCalledWith('', 'en-US')
    })

    it('should render language text when selected language value is empty string', () => {
      mockLanguages = [{ value: '' as string, name: 'Unknown Language', example: '' }]

      renderWithProvider({}, {
        text2speech: { enabled: true, language: '', voice: '', autoPlay: TtsAutoPlay.disabled },
      })

      expect(screen.getByText(/voice\.language\./)).toBeInTheDocument()
    })
  })
})
