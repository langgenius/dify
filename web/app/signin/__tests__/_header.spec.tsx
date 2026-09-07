import { fireEvent, screen } from '@testing-library/react'
import { setLocaleOnClient } from '@/i18n-config'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import Header from '../_header'

vi.mock('@/i18n-config', () => ({
  setLocaleOnClient: vi.fn(),
}))

vi.mock('@/next/dynamic', () => ({
  default: () => () => null,
}))

vi.mock('../_locale-menu', () => ({
  default: ({ onChange }: { onChange?: (value: string) => void }) => (
    <button type="button" onClick={() => onChange?.('ja-JP')}>
      Switch Language
    </button>
  ),
}))

const mockSetLocaleOnClient = vi.mocked(setLocaleOnClient)

describe('Signin Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the application title as the custom logo accessible name', () => {
    render(<Header />, {
      systemFeatures: {
        branding: {
          application_title: 'Acme AI',
          enabled: true,
          login_page_logo: 'https://example.com/acme-logo.svg',
        },
      },
    })

    expect(screen.getByRole('img', { name: 'Acme AI' })).toHaveAttribute(
      'src',
      'https://example.com/acme-logo.svg',
    )
  })

  it('treats a custom logo as decorative when the application title is empty', () => {
    const { container } = render(<Header />, {
      systemFeatures: {
        branding: {
          application_title: '',
          enabled: true,
          login_page_logo: 'https://example.com/custom-logo.svg',
        },
      },
    })

    expect(container.querySelector('img')).toHaveAttribute('alt', '')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('keeps the default Dify logo accessible name', () => {
    render(<Header />)

    expect(screen.getByRole('img', { name: 'Dify' })).toBeInTheDocument()
  })

  it('should switch locale without forcing a full page reload', () => {
    render(<Header />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch Language' }))

    expect(mockSetLocaleOnClient).toHaveBeenCalledWith('ja-JP', false)
  })
})
