import { render, screen } from '@testing-library/react'
import NoApps from '../index'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

describe('NoApps', () => {
  it('links users to the publishing documentation', () => {
    render(<NoApps />)

    expect(screen.getByRole('link', { name: 'explore.sidebar.noApps.learnMore' })).toHaveAttribute(
      'href',
      'https://docs.dify.ai/use-dify/publish/README',
    )
  })
})
