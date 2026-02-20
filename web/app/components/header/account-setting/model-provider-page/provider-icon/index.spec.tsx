import type { ModelProvider } from '../declarations'
import { render, screen } from '@testing-library/react'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { useLanguage } from '../hooks'
import ProviderIcon from './index'

type UseThemeReturnType = ReturnType<typeof useTheme>

vi.mock('@/app/components/base/icons/src/public/llm', () => ({
  AnthropicDark: ({ className }: { className: string }) => <div data-testid="anthropic-dark" className={className} />,
  AnthropicLight: ({ className }: { className: string }) => <div data-testid="anthropic-light" className={className} />,
}))

vi.mock('@/app/components/base/icons/src/vender/other', () => ({
  Openai: ({ className }: { className: string }) => <div data-testid="openai-icon" className={className} />,
}))

vi.mock('@/i18n-config', () => ({
  renderI18nObject: (obj: Record<string, string> | string, lang: string) => {
    if (typeof obj === 'string')
      return obj
    return obj[lang] || obj.en_US || Object.values(obj)[0]
  },
}))

vi.mock('@/hooks/use-theme', () => {
  const mockFn = vi.fn(() => ({ theme: Theme.light }))
  return { default: mockFn }
})

vi.mock('../hooks', () => ({
  useLanguage: vi.fn(() => 'en_US'),
}))

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  provider: 'some/provider',
  label: { en_US: 'Provider', zh_Hans: '提供商' },
  help: { title: { en_US: 'Help', zh_Hans: '帮助' }, url: { en_US: 'https://example.com', zh_Hans: 'https://example.com' } },
  icon_small: { en_US: 'https://example.com/icon.png', zh_Hans: 'https://example.com/icon.png' },
  supported_model_types: [],
  configurate_methods: [],
  provider_credential_schema: { credential_form_schemas: [] },
  model_credential_schema: { model: { label: { en_US: 'Model', zh_Hans: '模型' }, placeholder: { en_US: 'Select', zh_Hans: '选择' } }, credential_form_schemas: [] },
  preferred_provider_type: undefined,
  ...overrides,
} as ModelProvider)

describe('ProviderIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const mockTheme = vi.mocked(useTheme)
    const mockLang = vi.mocked(useLanguage)
    mockTheme.mockReturnValue({ theme: Theme.light, themes: [], setTheme: vi.fn() } as UseThemeReturnType)
    mockLang.mockReturnValue('en_US')
  })

  it('should render Anthropic icon based on theme', () => {
    const mockTheme = vi.mocked(useTheme)
    mockTheme.mockReturnValue({ theme: Theme.dark, themes: [], setTheme: vi.fn() } as UseThemeReturnType)
    const provider = createProvider({ provider: 'langgenius/anthropic/anthropic' })

    render(<ProviderIcon provider={provider} />)
    expect(screen.getByTestId('anthropic-light')).toBeInTheDocument()

    mockTheme.mockReturnValue({ theme: Theme.light, themes: [], setTheme: vi.fn() } as UseThemeReturnType)
    render(<ProviderIcon provider={provider} />)
    expect(screen.getByTestId('anthropic-dark')).toBeInTheDocument()
  })

  it('should render OpenAI icon', () => {
    const provider = createProvider({ provider: 'langgenius/openai/openai' })
    render(<ProviderIcon provider={provider} />)
    expect(screen.getByTestId('openai-icon')).toBeInTheDocument()
  })

  it('should render generic provider with image and label', () => {
    const provider = createProvider({ label: { en_US: 'Custom', zh_Hans: '自定义' } })
    render(<ProviderIcon provider={provider} />)

    const img = screen.getByAltText('provider-icon') as HTMLImageElement
    expect(img.src).toBe('https://example.com/icon.png')
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  it('should use dark icon in dark theme for generic provider', () => {
    const mockTheme = vi.mocked(useTheme)
    mockTheme.mockReturnValue({ theme: Theme.dark, themes: [], setTheme: vi.fn() } as UseThemeReturnType)
    const provider = createProvider({
      icon_small_dark: { en_US: 'https://example.com/dark.png', zh_Hans: 'https://example.com/dark.png' },
    })

    render(<ProviderIcon provider={provider} />)
    const img = screen.getByAltText('provider-icon') as HTMLImageElement
    expect(img.src).toBe('https://example.com/dark.png')
  })
})
