import { render, screen } from '@testing-library/react'
import { DifyLogo } from '../dify-logo'

describe('DifyLogo', () => {
  it('uses the provided alternative text as its accessible name', () => {
    const { container, rerender } = render(<DifyLogo alt="Dify" />)

    expect(screen.getByRole('img', { name: 'Dify' })).toHaveAttribute('src', '/logo/logo.svg')

    rerender(<DifyLogo alt="" />)

    const decorativeLogo = container.querySelector('img')
    expect(decorativeLogo).toHaveAttribute('alt', '')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
