import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppModeEnum } from '@/types/app'
import Doc from '../doc'

vi.mock('../template/template.en.mdx', () => ({ default: () => <div>completion-en</div> }))
vi.mock('../template/template.zh.mdx', () => ({ default: () => <div>completion-zh</div> }))
vi.mock('../template/template.ja.mdx', () => ({ default: () => <div>completion-ja</div> }))
vi.mock('../template/template_chat.en.mdx', () => ({ default: () => <div>chat-en</div> }))
vi.mock('../template/template_chat.zh.mdx', () => ({ default: () => <div>chat-zh</div> }))
vi.mock('../template/template_chat.ja.mdx', () => ({ default: () => <div>chat-ja</div> }))
vi.mock('../template/template_advanced_chat.en.mdx', () => ({
  default: () => <div>advanced-chat-en</div>,
}))
vi.mock('../template/template_advanced_chat.zh.mdx', () => ({
  default: () => <div>advanced-chat-zh</div>,
}))
vi.mock('../template/template_advanced_chat.ja.mdx', () => ({
  default: () => <div>advanced-chat-ja</div>,
}))
vi.mock('../template/template_workflow.en.mdx', () => ({ default: () => <div>workflow-en</div> }))
vi.mock('../template/template_workflow.zh.mdx', () => ({ default: () => <div>workflow-zh</div> }))
vi.mock('../template/template_workflow.ja.mdx', () => ({ default: () => <div>workflow-ja</div> }))

const mockLocale = vi.fn(() => 'en-US')

vi.mock('@/context/i18n', () => ({
  useLocale: () => mockLocale(),
}))

vi.mock('@/i18n-config/language', () => ({
  LanguagesSupported: ['en-US', 'zh-Hans', 'ja-JP'],
  getDocLanguage: (locale: string) =>
    locale === 'zh-Hans' ? 'zh' : locale === 'ja-JP' ? 'ja' : 'en',
}))

const makeAppDetail = (mode: AppModeEnum) =>
  ({
    mode,
    model_config: { configs: { prompt_variables: [] } },
  }) as unknown as Parameters<typeof Doc>[0]['appDetail']

describe('Doc', () => {
  beforeEach(() => {
    mockLocale.mockReturnValue('en-US')
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    })
  })

  it.each([
    [AppModeEnum.CHAT, 'chat-en'],
    [AppModeEnum.AGENT_CHAT, 'chat-en'],
    [AppModeEnum.ADVANCED_CHAT, 'advanced-chat-en'],
    [AppModeEnum.WORKFLOW, 'workflow-en'],
    [AppModeEnum.COMPLETION, 'completion-en'],
  ])('selects the documentation for %s apps', (mode, template) => {
    render(<Doc appDetail={makeAppDetail(mode)} />)

    expect(screen.getByText(template)).toBeInTheDocument()
  })

  it.each([
    ['zh-Hans', 'chat-zh'],
    ['ja-JP', 'chat-ja'],
  ])('selects the %s documentation', (locale, template) => {
    mockLocale.mockReturnValue(locale)
    render(<Doc appDetail={makeAppDetail(AppModeEnum.CHAT)} />)

    expect(screen.getByText(template)).toBeInTheDocument()
  })

  it('expands the table of contents', async () => {
    const user = userEvent.setup()
    render(<Doc appDetail={makeAppDetail(AppModeEnum.CHAT)} />)

    await user.click(screen.getByRole('button', { name: 'Open table of contents' }))

    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })
})
