import { screen, within } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { AuthShell } from '..'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

describe('AuthShell', () => {
  it('separates the site header, page content, and copyright', () => {
    render(
      <AuthShell>
        <h1>Sign in</h1>
      </AuthShell>,
      { systemFeatures: { branding: { enabled: false } } },
    )

    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).not.toContainElement(main)
    expect(screen.getByRole('contentinfo')).toHaveTextContent('LangGenius')
    expect(main).not.toContainElement(screen.getByRole('banner'))
    expect(main).not.toContainElement(screen.getByRole('contentinfo'))
  })

  it('omits the header when asked and the copyright under custom branding', () => {
    render(
      <AuthShell header={false}>
        <h1>Sign in</h1>
      </AuthShell>,
      { systemFeatures: { branding: { enabled: true } } },
    )

    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  })
})
