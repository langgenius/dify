import type { Features } from '../../../types'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as render,
} from '@/test/console/query-data'
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

let seedVoices = true
const getAppVoices = vi.fn()
const getAgentVoices = vi.fn()
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.textToAudio.voices.get': (input) => getAppVoices(input),
      'agent.byAgentId.textToAudio.voices.get': (input) => getAgentVoices(input),
    }),
  }
})

const mockGetAudioPlayer = vi.fn(() => ({ playAudio: vi.fn(), pauseAudio: vi.fn() }))

vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: () => ({ getAudioPlayer: mockGetAudioPlayer }),
  },
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
  const queryClient = createConsoleQueryClient()
  if (seedVoices && mockVoiceItems) {
    const language = features.text2speech?.language || 'en-US'
    if (mockParams.agentId)
      queryClient.setQueryData(
        consoleQuery.agent.byAgentId.textToAudio.voices.get.queryKey({
          input: { params: { agent_id: mockParams.agentId }, query: { language } },
        }),
        mockVoiceItems,
      )
    else if (mockParams.appId)
      queryClient.setQueryData(
        consoleQuery.apps.byAppId.textToAudio.voices.get.queryKey({
          input: { params: { app_id: mockParams.appId }, query: { language } },
        }),
        mockVoiceItems,
      )
  }
  return render(
    <FeaturesProvider features={features}>
      <ParamConfigContent onClose={props.onClose ?? vi.fn()} onChange={props.onChange} />
    </FeaturesProvider>,
    { queryClient },
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
    seedVoices = true
    getAppVoices.mockImplementation(() => Promise.resolve(mockVoiceItems ?? []))
    getAgentVoices.mockImplementation(() => Promise.resolve(mockVoiceItems ?? []))
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

      expect(getLanguageSelect()).toHaveTextContent('voice.language.enUS')
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
        request: getAppVoices,
      },
      {
        route: 'Agent',
        params: { agentId: 'test-agent-id' },
        requestParams: { agent_id: 'test-agent-id' },
        request: getAgentVoices,
      },
    ])(
      'should load and select voices using the $route route ID',
      async ({ params, requestParams, request }) => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        mockParams = params
        seedVoices = false

        renderWithProvider({ onChange })

        await waitFor(() =>
          expect(request).toHaveBeenCalledWith({
            params: requestParams,
            query: { language: 'en-US' },
          }),
        )

        await user.click(getVoiceSelect())
        await user.click(await screen.findByRole('option', { name: 'Echo' }))

        expect(getVoiceSelect()).toHaveTextContent('Echo')
        expect(onChange).toHaveBeenCalled()

        await user.click(getLanguageSelect())
        await user.click(await screen.findByRole('option', { name: /voice\.language\.zhHans/ }))

        await waitFor(() =>
          expect(request).toHaveBeenCalledWith({
            params: requestParams,
            query: { language: 'zh-Hans' },
          }),
        )
      },
    )

    it('should call onClose when close button receives Enter key', async () => {
      const onClose = vi.fn()
      renderWithProvider({ onClose })

      const closeButton = screen.getByRole('button', { name: /close/i })
      closeButton.focus()
      await userEvent.keyboard('{Enter}')

      expect(onClose).toHaveBeenCalled()
    })

    it('should toggle autoPlay switch and call onChange', async () => {
      const onChange = vi.fn()
      renderWithProvider({ onChange })

      await userEvent.click(screen.getByRole('switch'))

      expect(screen.getByRole('switch')).toBeChecked()
      expect(onChange).toHaveBeenCalledOnce()
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

      expect(getAppVoices).not.toHaveBeenCalled()
      expect(getAgentVoices).not.toHaveBeenCalled()
    })
  })
})
