import type { ChatConfig } from '@/app/components/base/chat/types'
import type { Locale } from '@/i18n-config/language'
import type { SiteInfo } from '@/models/share'
import { renderHook } from '@testing-library/react'
import { useWebAppStore } from '@/context/web-app-context'
import { PromptMode } from '@/models/debug'
import { useAppConfig } from './use-app-config'

// Mock changeLanguage side-effect
const mockChangeLanguage = vi.fn()
vi.mock('@/i18n-config/client', () => ({
  changeLanguage: (...args: unknown[]) => mockChangeLanguage(...args),
}))

const baseSiteInfo: SiteInfo = {
  title: 'My App',
  icon_type: 'emoji',
  icon: '🤖',
  icon_background: '#fff',
  icon_url: '',
  description: 'A test app',
  default_language: 'en-US' as Locale,
  prompt_public: false,
  copyright: '',
  privacy_policy: '',
  custom_disclaimer: '',
  show_workflow_steps: false,
  use_icon_as_answer_icon: false,
  chat_color_theme: '',
}

const baseAppParams = {
  user_input_form: [
    { 'text-input': { label: 'Name', variable: 'name', required: true, default: '', max_length: 100, hide: false } },
  ],
  more_like_this: { enabled: true },
  text_to_speech: { enabled: false },
  file_upload: {
    allowed_file_upload_methods: ['local_file'],
    allowed_file_types: [],
    max_length: 10,
    number_limits: 3,
  },
  system_parameters: {
    audio_file_size_limit: 50,
    file_size_limit: 15,
    image_file_size_limit: 10,
    video_file_size_limit: 100,
    workflow_file_upload_limit: 10,
  },
  opening_statement: '',
  pre_prompt: '',
  prompt_type: PromptMode.simple,
  suggested_questions_after_answer: { enabled: false },
  speech_to_text: { enabled: false },
  retriever_resource: { enabled: false },
  sensitive_word_avoidance: { enabled: false },
  agent_mode: { enabled: false, tools: [] },
  dataset_configs: { datasets: { datasets: [] }, retrieval_model: 'single' },
} as unknown as ChatConfig

describe('useAppConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Default state when store has no data
  describe('Default state', () => {
    it('should return not-ready state when store is empty', () => {
      useWebAppStore.setState({ appInfo: null, appParams: null })

      const { result } = renderHook(() => useAppConfig())

      expect(result.current.appId).toBe('')
      expect(result.current.siteInfo).toBeNull()
      expect(result.current.promptConfig).toBeNull()
      expect(result.current.isReady).toBe(false)
    })
  })

  // Deriving config from store data
  describe('Config derivation', () => {
    it('should derive appId and siteInfo from appInfo', () => {
      useWebAppStore.setState({
        appInfo: { app_id: 'app-123', site: baseSiteInfo, custom_config: null },
        appParams: baseAppParams,
      })

      const { result } = renderHook(() => useAppConfig())

      expect(result.current.appId).toBe('app-123')
      expect(result.current.siteInfo?.title).toBe('My App')
    })

    it('should derive promptConfig with prompt_variables from user_input_form', () => {
      useWebAppStore.setState({
        appInfo: { app_id: 'app-1', site: baseSiteInfo, custom_config: null },
        appParams: baseAppParams,
      })

      const { result } = renderHook(() => useAppConfig())

      expect(result.current.promptConfig).not.toBeNull()
      expect(result.current.promptConfig!.prompt_variables).toHaveLength(1)
      expect(result.current.promptConfig!.prompt_variables[0].key).toBe('name')
    })

    it('should derive moreLikeThisConfig and textToSpeechConfig from appParams', () => {
      useWebAppStore.setState({
        appInfo: { app_id: 'app-1', site: baseSiteInfo, custom_config: null },
        appParams: baseAppParams,
      })

      const { result } = renderHook(() => useAppConfig())

      expect(result.current.moreLikeThisConfig).toEqual({ enabled: true })
      expect(result.current.textToSpeechConfig).toEqual({ enabled: false })
    })

    it('should derive visionConfig from file_upload and system_parameters', () => {
      useWebAppStore.setState({
        appInfo: { app_id: 'app-1', site: baseSiteInfo, custom_config: null },
        appParams: baseAppParams,
      })

      const { result } = renderHook(() => useAppConfig())

      expect(result.current.visionConfig.transfer_methods).toEqual(['local_file'])
      expect(result.current.visionConfig.image_file_size_limit).toBe(10)
    })

    it('should return default visionConfig when appParams is null', () => {
      useWebAppStore.setState({
        appInfo: { app_id: 'app-1', site: baseSiteInfo, custom_config: null },
        appParams: null,
      })

      const { result } = renderHook(() => useAppConfig())

      expect(result.current.visionConfig.enabled).toBe(false)
      expect(result.current.visionConfig.number_limits).toBe(2)
    })

    it('should return customConfig from appInfo', () => {
      useWebAppStore.setState({
        appInfo: { app_id: 'app-1', site: baseSiteInfo, custom_config: { remove_webapp_brand: true } },
        appParams: baseAppParams,
      })

      const { result } = renderHook(() => useAppConfig())

      expect(result.current.customConfig).toEqual({ remove_webapp_brand: true })
    })
  })

  // Readiness condition
  describe('isReady', () => {
    it('should be true when appId, siteInfo and promptConfig are all present', () => {
      useWebAppStore.setState({
        appInfo: { app_id: 'app-1', site: baseSiteInfo, custom_config: null },
        appParams: baseAppParams,
      })

      const { result } = renderHook(() => useAppConfig())

      expect(result.current.isReady).toBe(true)
    })

    it('should be false when appParams is missing (no promptConfig)', () => {
      useWebAppStore.setState({
        appInfo: { app_id: 'app-1', site: baseSiteInfo, custom_config: null },
        appParams: null,
      })

      const { result } = renderHook(() => useAppConfig())

      expect(result.current.isReady).toBe(false)
    })

    it('should be false when appInfo is missing (no appId or siteInfo)', () => {
      useWebAppStore.setState({ appInfo: null, appParams: baseAppParams })

      const { result } = renderHook(() => useAppConfig())

      expect(result.current.isReady).toBe(false)
    })
  })

  // Language sync side-effect
  describe('Language sync', () => {
    it('should call changeLanguage when siteInfo has default_language', () => {
      useWebAppStore.setState({
        appInfo: { app_id: 'app-1', site: baseSiteInfo, custom_config: null },
        appParams: baseAppParams,
      })

      renderHook(() => useAppConfig())

      expect(mockChangeLanguage).toHaveBeenCalledWith('en-US')
    })

    it('should not call changeLanguage when siteInfo is null', () => {
      useWebAppStore.setState({ appInfo: null, appParams: null })

      renderHook(() => useAppConfig())

      expect(mockChangeLanguage).not.toHaveBeenCalled()
    })
  })
})
