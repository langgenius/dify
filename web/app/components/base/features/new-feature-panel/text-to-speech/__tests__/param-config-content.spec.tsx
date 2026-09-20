import type { Features } from '../../../types'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { skipToken } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { TtsAutoPlay } from '@/types/app'
import { FeaturesProvider } from '../../../context'
import ParamConfigContent from '../param-config-content'

let mockLanguages = [
  { value: 'en-US', name: 'English', example: 'Hello world' },
  { value: 'zh-Hans', name: '中文', example: '你好' },
]

let mockParams: { appId?: string; agentId?: string } = { appId: 'test-app-id' }

let mockVoiceItems: { value: string; name: string }[] | undefined = [
  { value: 'alloy', name: 'Alloy' },
  { value: 'echo', name: 'Echo' },
]

type VoicesQueryOptions = {
  enabled?: boolean
  input:
    | typeof skipToken
    | {
        params: { app_id: string } | { agent_id: string }
        query: { language: string }
      }
}

const mockVoicesQuery = vi.fn((_options: VoicesQueryOptions) => ({
  data: mockVoiceItems,
}))

const mockGetAudioPlayer = vi.fn(() => ({ playAudio: vi.fn(), pauseAudio: vi.fn() }))

vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: () => ({ getAudioPlayer: mockGetAudioPlayer }),
  },
}))

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: VoicesQueryOptions) => mockVoicesQuery(options),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () =>
    mockParams.appId
      ? `/app/${mockParams.appId}/configuration`
      : mockParams.agentId
        ? `/agents/${mockParams.agentId}/configure`
        : '/configuration',
  useParams: () => mockParams,
}))

vi.mock('@/i18n/language', () => ({
  get languages() {
    return mockLanguages
  },
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
  props: { onClose?: () => void; onChange?: OnFeaturesChange } = {},
  featureOverrides?: Partial<Features>,
) => {
  const features = { ...defaultFeatures, ...featureOverrides }
  return render(
    <FeaturesProvider features={features}>
      <ParamConfigContent onClose={props.onClose ?? vi.fn()} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

const getLanguageSelect = () =>
  screen.getByRole('combobox', { name: /voice\.voiceSettings\.language/ })
const getVoiceSelect = () => screen.getByRole('combobox', { name: /voice\.voiceSettings\.voice/ })

describe('ParamConfigContent', () => {
  beforeAll(async () => {
    await i18next.init({})
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockParams = { appId: 'test-app-id' }
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

      expect(screen.getByText(/voice\.voiceSettings\.title/))!.toBeInTheDocument()
    })

    it('should render language label', () => {
      renderWithProvider()

      expect(screen.getByText(/voice\.voiceSettings\.language/))!.toBeInTheDocument()
    })

    it('should render voice label', () => {
      renderWithProvider()

      expect(screen.getByText(/voice\.voiceSettings\.voice/))!.toBeInTheDocument()
    })

    it('should render autoPlay toggle', () => {
      renderWithProvider()

      expect(screen.getByText(/voice\.voiceSettings\.autoPlay/))!.toBeInTheDocument()
      expect(screen.getByRole('switch'))!.toBeInTheDocument()
    })

    it('should render tooltip icon for language', () => {
      renderWithProvider()

      const languageLabel = screen.getByText(/voice\.voiceSettings\.language/)
      expect(languageLabel)!.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /voice\.voiceSettings\.resolutionTooltip/ }),
      )!.toBeInTheDocument()
    })

    it('should display language listbox button', () => {
      renderWithProvider()

      expect(getLanguageSelect()).toBeInTheDocument()
    })

    it('should display current voice in listbox button', () => {
      renderWithProvider()

      expect(getVoiceSelect()).toHaveTextContent('Alloy')
    })

    it('should render audition button when language has example', () => {
      renderWithProvider()

      const auditionButton = screen.queryByRole('group', { name: /appApi\.play|play/i })
      expect(auditionButton)!.toBeInTheDocument()
    })

    it('should not render audition button when language has no example', () => {
      mockLanguages = [
        { value: 'en-US', name: 'English', example: '' },
        { value: 'zh-Hans', name: '中文', example: '' },
      ]

      renderWithProvider()

      const auditionButton = screen.queryByRole('group', { name: /appApi\.play|play/i })
      expect(auditionButton).toBeNull()
    })

    it('should render with no language set and use first as default', () => {
      renderWithProvider(
        {},
        {
          text2speech: { enabled: true, language: '', voice: '', autoPlay: TtsAutoPlay.disabled },
        },
      )

      expect(getLanguageSelect()).toBeInTheDocument()
    })

    it('should render with no voice set and use first as default', () => {
      renderWithProvider(
        {},
        {
          text2speech: {
            enabled: true,
            language: 'en-US',
            voice: 'nonexistent',
            autoPlay: TtsAutoPlay.disabled,
          },
        },
      )

      expect(getVoiceSelect()).toHaveTextContent('Alloy')
    })
  })

  // User-triggered behavior and callbacks.
  describe('User Interactions', () => {
    it('should audition the displayed fallback voice on an agent page', async () => {
      const user = userEvent.setup()
      mockParams = { agentId: 'agent-1' }
      renderWithProvider(
        {},
        { text2speech: { ...defaultFeatures.text2speech, enabled: true, voice: 'removed-voice' } },
      )

      expect(getVoiceSelect()).toHaveTextContent('Alloy')
      await user.click(screen.getByRole('button', { name: /play/i }))

      expect(mockGetAudioPlayer).toHaveBeenCalledWith(
        '/agent/agent-1/text-to-audio',
        false,
        undefined,
        'Hello world',
        'alloy',
        expect.any(Function),
      )
    })

    it.each([
      {
        route: 'Chatflow',
        params: { appId: 'test-app-id' },
        requestParams: { app_id: 'test-app-id' },
        operation: ['console', 'apps', 'byAppId', 'textToAudio', 'voices', 'get'],
      },
      {
        route: 'Agent',
        params: { agentId: 'test-agent-id' },
        requestParams: { agent_id: 'test-agent-id' },
        operation: ['console', 'agent', 'byAgentId', 'textToAudio', 'voices', 'get'],
      },
    ])(
      'should load and select voices using the $route route ID',
      async ({ params, requestParams, operation }) => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        mockParams = params

        renderWithProvider({ onChange })

        expect(mockVoicesQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: expect.arrayContaining([operation]),
            input: {
              params: requestParams,
              query: { language: 'en-US' },
            },
          }),
        )

        await user.click(getVoiceSelect())
        await user.click(await screen.findByRole('option', { name: 'Echo' }))

        expect(getVoiceSelect()).toHaveTextContent('Echo')
        expect(onChange).toHaveBeenCalled()

        await user.click(getLanguageSelect())
        await user.click(await screen.findByRole('option', { name: /voice\.language\.zhHans/ }))

        expect(mockVoicesQuery).toHaveBeenLastCalledWith(
          expect.objectContaining({
            queryKey: expect.arrayContaining([operation]),
            input: {
              params: requestParams,
              query: { language: 'zh-Hans' },
            },
          }),
        )
      },
    )

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
        {
          text2speech: {
            enabled: true,
            language: 'en-US',
            voice: 'alloy',
            autoPlay: TtsAutoPlay.enabled,
          },
        },
      )

      const autoPlaySwitch = screen.getByRole('switch')
      expect(autoPlaySwitch)!.toHaveAttribute('aria-checked', 'true')

      await userEvent.click(autoPlaySwitch)

      expect(autoPlaySwitch)!.toHaveAttribute('aria-checked', 'false')
      expect(onChange).toHaveBeenCalled()
    })

    it('should call feature update without onChange callback', async () => {
      renderWithProvider()

      await userEvent.click(screen.getByRole('switch'))

      expect(screen.getByRole('switch'))!.toBeInTheDocument()
    })

    it('should open language listbox and show options', async () => {
      renderWithProvider()

      await userEvent.click(getLanguageSelect())

      const options = await screen.findAllByRole('option')
      expect(options.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle language change', async () => {
      const onChange = vi.fn()
      renderWithProvider({ onChange })

      await userEvent.click(getLanguageSelect())
      const options = await screen.findAllByRole('option')
      expect(options.length).toBeGreaterThan(1)
      await userEvent.click(options[1]!)
      expect(onChange).toHaveBeenCalled()
    })

    it('should handle voice change', async () => {
      const onChange = vi.fn()
      renderWithProvider({ onChange })

      await userEvent.click(getVoiceSelect())
      const options = await screen.findAllByRole('option')
      expect(options.length).toBeGreaterThan(1)
      await userEvent.click(options[1]!)
      expect(onChange).toHaveBeenCalled()
    })

    it('should show selected language option in listbox', async () => {
      renderWithProvider()

      await userEvent.click(getLanguageSelect())
      const options = await screen.findAllByRole('option')
      expect(options.length).toBeGreaterThanOrEqual(1)

      const selectedOption = options.find((opt) => opt.textContent?.includes('voice.language.enUS'))
      expect(selectedOption).toBeDefined()
      expect(selectedOption)!.toHaveAttribute('aria-selected', 'true')
    })

    it('should show selected voice option in listbox', async () => {
      renderWithProvider()

      await userEvent.click(getVoiceSelect())
      const options = await screen.findAllByRole('option')
      expect(options.length).toBeGreaterThanOrEqual(1)

      const selectedOption = options.find((opt) => opt.textContent?.includes('Alloy'))
      expect(selectedOption).toBeDefined()
      expect(selectedOption)!.toHaveAttribute('aria-selected', 'true')
    })
  })

  // Fallback and boundary scenarios.
  describe('Edge Cases', () => {
    it('should show placeholder and disable voice selection when no languages are available', () => {
      mockLanguages = []
      mockVoiceItems = undefined

      renderWithProvider(
        {},
        {
          text2speech: {
            enabled: true,
            language: 'en-US',
            voice: 'alloy',
            autoPlay: TtsAutoPlay.disabled,
          },
        },
      )

      const placeholderTexts = screen.getAllByText(/placeholder\.select/)
      expect(placeholderTexts.length).toBeGreaterThanOrEqual(2)

      expect(getVoiceSelect()).toHaveAttribute('data-disabled')
    })

    it('should disable the voices query when neither an app nor Agent ID is available', () => {
      mockParams = {}

      renderWithProvider()

      expect(mockVoicesQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false,
          input: skipToken,
        }),
      )
    })

    it('should render language text when selected language value is empty string', () => {
      mockLanguages = [{ value: '' as string, name: 'Unknown Language', example: '' }]

      renderWithProvider(
        {},
        {
          text2speech: { enabled: true, language: '', voice: '', autoPlay: TtsAutoPlay.disabled },
        },
      )

      expect(screen.getByText(/voice\.language\./))!.toBeInTheDocument()
    })
  })
})
