import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModeEnum, Theme } from '@/types/app'
import Doc from '../doc'

// The vitest mdx-stub plugin makes .mdx files parseable; these mocks replace
vi.mock('../template/template.en.mdx', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="template-completion-en" />,
}))
vi.mock('../template/template.zh.mdx', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="template-completion-zh" />,
}))
vi.mock('../template/template.ja.mdx', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="template-completion-ja" />,
}))
vi.mock('../template/template_chat.en.mdx', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="template-chat-en" />,
}))
vi.mock('../template/template_chat.zh.mdx', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="template-chat-zh" />,
}))
vi.mock('../template/template_chat.ja.mdx', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="template-chat-ja" />,
}))
vi.mock('../template/template_advanced_chat.en.mdx', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="template-advanced-chat-en" />,
}))
vi.mock('../template/template_advanced_chat.zh.mdx', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="template-advanced-chat-zh" />,
}))
vi.mock('../template/template_advanced_chat.ja.mdx', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="template-advanced-chat-ja" />,
}))
vi.mock('../template/template_workflow.en.mdx', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="template-workflow-en" />,
}))
vi.mock('../template/template_workflow.zh.mdx', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="template-workflow-zh" />,
}))
vi.mock('../template/template_workflow.ja.mdx', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="template-workflow-ja" />,
}))

const mockLocale = vi.fn().mockReturnValue('en-US')
vi.mock('@/context/i18n', () => ({
  useLocale: () => mockLocale(),
}))

const mockTheme = vi.fn().mockReturnValue(Theme.light)
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mockTheme() }),
}))

vi.mock('@/i18n-config/language', () => ({
  LanguagesSupported: ['en-US', 'zh-Hans', 'zh-Hant', 'pt-BR', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP'],
  getDocLanguage: (locale: string) => {
    const map: Record<string, string> = { 'zh-Hans': 'zh', 'ja-JP': 'ja' }
    return map[locale] || 'en'
  },
}))

describe('Doc', () => {
  const makeAppDetail = (mode: AppModeEnum, variables: Array<{ key: string, name: string }> = []) => ({
    mode,
    model_config: {
      configs: {
        prompt_variables: variables,
      },
    },
  }) as unknown as Parameters<typeof Doc>[0]['appDetail']

  beforeEach(() => {
    vi.clearAllMocks()
    mockLocale.mockReturnValue('en-US')
    mockTheme.mockReturnValue(Theme.light)

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    })
  })

  describe('template selection by app mode', () => {
    it.each([
      [AppModeEnum.CHAT, 'template-chat-en'],
      [AppModeEnum.AGENT_CHAT, 'template-chat-en'],
      [AppModeEnum.ADVANCED_CHAT, 'template-advanced-chat-en'],
      [AppModeEnum.WORKFLOW, 'template-workflow-en'],
      [AppModeEnum.COMPLETION, 'template-completion-en'],
    ])('should render correct EN template for mode %s', (mode, testId) => {
      render(<Doc appDetail={makeAppDetail(mode)} />)
      expect(screen.getByTestId(testId)).toBeInTheDocument()
    })
  })

  describe('template selection by locale', () => {
    it('should render ZH template when locale is zh-Hans', () => {
      mockLocale.mockReturnValue('zh-Hans')
      render(<Doc appDetail={makeAppDetail(AppModeEnum.CHAT)} />)
      expect(screen.getByTestId('template-chat-zh')).toBeInTheDocument()
    })

    it('should render JA template when locale is ja-JP', () => {
      mockLocale.mockReturnValue('ja-JP')
      render(<Doc appDetail={makeAppDetail(AppModeEnum.CHAT)} />)
      expect(screen.getByTestId('template-chat-ja')).toBeInTheDocument()
    })

    it('should fall back to EN template for unsupported locales', () => {
      mockLocale.mockReturnValue('fr-FR')
      render(<Doc appDetail={makeAppDetail(AppModeEnum.COMPLETION)} />)
      expect(screen.getByTestId('template-completion-en')).toBeInTheDocument()
    })

    it('should render ZH advanced-chat template', () => {
      mockLocale.mockReturnValue('zh-Hans')
      render(<Doc appDetail={makeAppDetail(AppModeEnum.ADVANCED_CHAT)} />)
      expect(screen.getByTestId('template-advanced-chat-zh')).toBeInTheDocument()
    })

    it('should render JA workflow template', () => {
      mockLocale.mockReturnValue('ja-JP')
      render(<Doc appDetail={makeAppDetail(AppModeEnum.WORKFLOW)} />)
      expect(screen.getByTestId('template-workflow-ja')).toBeInTheDocument()
    })
  })

  describe('null/undefined appDetail', () => {
    it('should render nothing when appDetail has no mode', () => {
      render(<Doc appDetail={{} as unknown as Parameters<typeof Doc>[0]['appDetail']} />)
      expect(screen.queryByTestId('template-completion-en')).not.toBeInTheDocument()
      expect(screen.queryByTestId('template-chat-en')).not.toBeInTheDocument()
    })

    it('should render nothing when appDetail is null', () => {
      render(<Doc appDetail={null as unknown as Parameters<typeof Doc>[0]['appDetail']} />)
      expect(screen.queryByTestId('template-completion-en')).not.toBeInTheDocument()
    })
  })

  describe('TOC toggle', () => {
    it('should show collapsed TOC button by default on small screens', () => {
      render(<Doc appDetail={makeAppDetail(AppModeEnum.CHAT)} />)
      expect(screen.getByLabelText('Open table of contents')).toBeInTheDocument()
    })

    it('should show expanded TOC on wide screens', () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockReturnValue({ matches: true }),
      })
      render(<Doc appDetail={makeAppDetail(AppModeEnum.CHAT)} />)
      expect(screen.getByText('appApi.develop.toc')).toBeInTheDocument()
      expect(screen.getByLabelText('Close')).toBeInTheDocument()
    })

    it('should expand TOC when toggle button is clicked', async () => {
      render(<Doc appDetail={makeAppDetail(AppModeEnum.CHAT)} />)
      const toggleBtn = screen.getByLabelText('Open table of contents')
      await act(async () => {
        fireEvent.click(toggleBtn)
      })
      expect(screen.getByText('appApi.develop.toc')).toBeInTheDocument()
    })

    it('should collapse TOC when close button is clicked', async () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockReturnValue({ matches: true }),
      })
      render(<Doc appDetail={makeAppDetail(AppModeEnum.CHAT)} />)

      const closeBtn = screen.getByLabelText('Close')
      await act(async () => {
        fireEvent.click(closeBtn)
      })
      expect(screen.getByLabelText('Open table of contents')).toBeInTheDocument()
    })
  })

  describe('dark theme', () => {
    it('should apply prose-invert class in dark mode', () => {
      mockTheme.mockReturnValue(Theme.dark)
      const { container } = render(<Doc appDetail={makeAppDetail(AppModeEnum.CHAT)} />)
      const article = container.querySelector('article')
      expect(article?.className).toContain('prose-invert')
    })

    it('should not apply prose-invert class in light mode', () => {
      mockTheme.mockReturnValue(Theme.light)
      const { container } = render(<Doc appDetail={makeAppDetail(AppModeEnum.CHAT)} />)
      const article = container.querySelector('article')
      expect(article?.className).not.toContain('prose-invert')
    })
  })

  describe('article structure', () => {
    it('should render article with prose classes', () => {
      const { container } = render(<Doc appDetail={makeAppDetail(AppModeEnum.COMPLETION)} />)
      const article = container.querySelector('article')
      expect(article).toBeInTheDocument()
      expect(article?.className).toContain('prose')
    })

    it('should render flex layout wrapper', () => {
      const { container } = render(<Doc appDetail={makeAppDetail(AppModeEnum.CHAT)} />)
      expect(container.querySelector('.flex')).toBeInTheDocument()
    })
  })
})
