import type { RefObject } from 'react'
import type { ChatConfig } from '../types'
import type { AppData, AppMeta, ConversationItem } from '@/models/share'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { useGlobalPublicStore } from '@/context/global-public-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { defaultSystemFeatures } from '@/types/feature'
import { useEmbeddedChatbot } from './hooks'
import EmbeddedChatbot from './index'

vi.mock('./hooks', () => ({
  useEmbeddedChatbot: vi.fn(),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: vi.fn(),
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('./chat-wrapper', () => ({
  __esModule: true,
  default: () => <div>chat area</div>,
}))

vi.mock('./header', () => ({
  __esModule: true,
  default: () => <div>chat header</div>,
}))

vi.mock('./theme/theme-context', () => ({
  useThemeContext: vi.fn(() => ({
    buildTheme: vi.fn(),
    theme: {
      backgroundHeaderColorStyle: '',
    },
  })),
}))

const mockIsDify = vi.fn(() => false)
vi.mock('./utils', () => ({
  isDify: () => mockIsDify(),
}))

type EmbeddedChatbotHookReturn = ReturnType<typeof useEmbeddedChatbot>

const createHookReturn = (overrides: Partial<EmbeddedChatbotHookReturn> = {}): EmbeddedChatbotHookReturn => {
  const appData: AppData = {
    app_id: 'app-1',
    can_replace_logo: true,
    custom_config: {
      remove_webapp_brand: false,
      replace_webapp_logo: '',
    },
    enable_site: true,
    end_user_id: 'user-1',
    site: {
      title: 'Embedded App',
      chat_color_theme: 'blue',
      chat_color_theme_inverted: false,
    },
  }

  const base: EmbeddedChatbotHookReturn = {
    appSourceType: 'webApp' as EmbeddedChatbotHookReturn['appSourceType'],
    isInstalledApp: false,
    appId: 'app-1',
    currentConversationId: '',
    currentConversationItem: undefined,
    removeConversationIdInfo: vi.fn(),
    handleConversationIdInfoChange: vi.fn(),
    appData,
    appParams: {} as ChatConfig,
    appMeta: { tool_icons: {} } as AppMeta,
    appPinnedConversationData: { data: [], has_more: false, limit: 20 },
    appConversationData: { data: [], has_more: false, limit: 20 },
    appConversationDataLoading: false,
    appChatListData: { data: [], has_more: false, limit: 20 },
    appChatListDataLoading: false,
    appPrevChatList: [],
    pinnedConversationList: [] as ConversationItem[],
    conversationList: [] as ConversationItem[],
    setShowNewConversationItemInList: vi.fn(),
    newConversationInputs: {},
    newConversationInputsRef: { current: {} } as unknown as RefObject<Record<string, unknown>>,
    handleNewConversationInputsChange: vi.fn(),
    inputsForms: [],
    handleNewConversation: vi.fn(),
    handleStartChat: vi.fn(),
    handleChangeConversation: vi.fn(),
    handleNewConversationCompleted: vi.fn(),
    newConversationId: '',
    chatShouldReloadKey: 'reload-key',
    allowResetChat: true,
    handleFeedback: vi.fn(),
    currentChatInstanceRef: { current: { handleStop: vi.fn() } },
    clearChatList: false,
    setClearChatList: vi.fn(),
    isResponding: false,
    setIsResponding: vi.fn(),
    currentConversationInputs: {},
    setCurrentConversationInputs: vi.fn(),
    allInputsHidden: false,
    initUserVariables: {},
  }

  return {
    ...base,
    ...overrides,
  }
}

describe('EmbeddedChatbot index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useBreakpoints).mockReturnValue(MediaType.mobile)
    vi.mocked(useEmbeddedChatbot).mockReturnValue(createHookReturn())
    vi.mocked(useGlobalPublicStore).mockImplementation(selector => selector({
      systemFeatures: {
        ...defaultSystemFeatures,
        branding: {
          ...defaultSystemFeatures.branding,
          enabled: true,
          workspace_logo: '',
        },
      },
      setSystemFeatures: vi.fn(),
    }))
  })

  describe('Loading and chat content', () => {
    it('should show loading state before chat content', () => {
      vi.mocked(useEmbeddedChatbot).mockReturnValue(createHookReturn({ appChatListDataLoading: true }))

      render(<EmbeddedChatbot />)

      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.queryByText('chat area')).not.toBeInTheDocument()
    })

    it('should render chat content when loading finishes', () => {
      render(<EmbeddedChatbot />)

      expect(screen.getByText('chat area')).toBeInTheDocument()
    })
  })

  describe('Powered by branding', () => {
    it('should show workspace logo on mobile when branding is enabled', () => {
      vi.mocked(useGlobalPublicStore).mockImplementation(selector => selector({
        systemFeatures: {
          ...defaultSystemFeatures,
          branding: {
            ...defaultSystemFeatures.branding,
            enabled: true,
            workspace_logo: 'https://example.com/workspace-logo.png',
          },
        },
        setSystemFeatures: vi.fn(),
      }))

      render(<EmbeddedChatbot />)

      expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
      expect(screen.getByAltText('logo')).toHaveAttribute('src', 'https://example.com/workspace-logo.png')
    })

    it('should show custom logo when workspace branding logo is unavailable', () => {
      vi.mocked(useEmbeddedChatbot).mockReturnValue(createHookReturn({
        appData: {
          app_id: 'app-1',
          can_replace_logo: true,
          custom_config: {
            remove_webapp_brand: false,
            replace_webapp_logo: 'https://example.com/custom-logo.png',
          },
          enable_site: true,
          end_user_id: 'user-1',
          site: {
            title: 'Embedded App',
            chat_color_theme: 'blue',
            chat_color_theme_inverted: false,
          },
        },
      }))

      render(<EmbeddedChatbot />)

      expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
      expect(screen.getByAltText('logo')).toHaveAttribute('src', 'https://example.com/custom-logo.png')
    })

    it('should hide powered by section when branding is removed', () => {
      vi.mocked(useEmbeddedChatbot).mockReturnValue(createHookReturn({
        appData: {
          app_id: 'app-1',
          can_replace_logo: true,
          custom_config: {
            remove_webapp_brand: true,
            replace_webapp_logo: '',
          },
          enable_site: true,
          end_user_id: 'user-1',
          site: {
            title: 'Embedded App',
            chat_color_theme: 'blue',
            chat_color_theme_inverted: false,
          },
        },
      }))

      render(<EmbeddedChatbot />)

      expect(screen.queryByText('share.chat.poweredBy')).not.toBeInTheDocument()
    })

    it('should not show powered by section on desktop', () => {
      vi.mocked(useBreakpoints).mockReturnValue(MediaType.pc)
      vi.mocked(useEmbeddedChatbot).mockReturnValue(createHookReturn({ appData: null }))
      mockIsDify.mockReturnValue(true)

      render(<EmbeddedChatbot />)

      expect(screen.queryByText('share.chat.poweredBy')).not.toBeInTheDocument()
      expect(screen.getByText('chat header')).toBeInTheDocument()
    })
  })
})
