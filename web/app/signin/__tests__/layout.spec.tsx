import { screen, within } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import SignInLayout from '../layout'

describe('SignInLayout landmarks', () => {
  it('separates the site header, sign-in content, and copyright', () => {
    render(
      <SignInLayout>
        <h1>Sign in</h1>
      </SignInLayout>,
      { systemFeatures: { branding: { enabled: false } } },
    )

    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).not.toContainElement(main)
    expect(screen.getByRole('contentinfo')).toHaveTextContent('LangGenius')
    expect(main).not.toContainElement(screen.getByRole('banner'))
    expect(main).not.toContainElement(screen.getByRole('contentinfo'))
  })
})
