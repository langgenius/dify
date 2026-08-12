import type { FormData } from '../form'
import { render, screen } from '@testing-library/react'
import FormContent from '../form'

const mockUseGetHumanInputForm = vi.hoisted(() => vi.fn())

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'token-123' }),
}))

vi.mock('@/service/use-share', () => ({
  useGetHumanInputForm: (...args: unknown[]) => mockUseGetHumanInputForm(...args),
  useSubmitHumanInputForm: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/hooks/use-document-title', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/content-item', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/expiration-time', () => ({
  __esModule: true,
  default: () => <div>expiration-time</div>,
}))

vi.mock('@/app/components/base/loading', () => ({
  __esModule: true,
  default: () => <div>loading</div>,
}))

vi.mock('@/app/components/base/logo/dify-logo', () => ({
  __esModule: true,
  default: () => <div>dify-logo</div>,
}))

vi.mock('@/app/components/base/app-icon', () => ({
  __esModule: true,
  default: () => <div>app-icon</div>,
}))

describe('human input share form branding', () => {
  const formData: FormData = {
    site: {
      site: { title: 'Review App' },
    },
    form_content: 'Please review',
    inputs: [],
    resolved_default_values: {},
    user_actions: [],
    expiration_time: 1750000000,
  }

  const renderWithCustomConfig = (customConfig: FormData['site']['custom_config']) => {
    mockUseGetHumanInputForm.mockReturnValue({
      data: {
        ...formData,
        site: { ...formData.site, custom_config: customConfig },
      },
      isLoading: false,
      error: null,
    })

    render(<FormContent />)
  }

  it('should render the Dify logo when the workspace has no branding overrides', () => {
    renderWithCustomConfig(null)

    expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
    expect(screen.getByText('dify-logo')).toBeInTheDocument()
  })

  it('should hide branding when remove_webapp_brand is enabled', () => {
    renderWithCustomConfig({
      remove_webapp_brand: true,
      replace_webapp_logo: null,
    })

    expect(screen.queryByText('share.chat.poweredBy')).not.toBeInTheDocument()
    expect(screen.queryByText('dify-logo')).not.toBeInTheDocument()
  })

  it('should render the custom branding logo when replace_webapp_logo is provided', () => {
    renderWithCustomConfig({
      remove_webapp_brand: false,
      replace_webapp_logo: 'https://example.com/custom-logo.png',
    })

    expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'logo' })).toHaveAttribute('src', 'https://example.com/custom-logo.png')
    expect(screen.queryByText('dify-logo')).not.toBeInTheDocument()
  })
})
