import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setLocaleOnClient } from '@/i18n/client'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import Header from '../_header'

vi.mock('@/i18n/client', () => ({
  setLocaleOnClient: vi.fn(),
}))

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

const mockSetLocaleOnClient = vi.mocked(setLocaleOnClient)

describe('Signin Header', () => {
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

  it('switches locale through the language menu without forcing a full page reload', async () => {
    const user = userEvent.setup()
    render(<Header />)

    await user.click(screen.getByRole('button', { name: /English/i }))
    await user.click(screen.getByRole('menuitemradio', { name: '日本語 (日本)' }))

    expect(mockSetLocaleOnClient).toHaveBeenCalledWith('ja-JP', false)
  })
})
