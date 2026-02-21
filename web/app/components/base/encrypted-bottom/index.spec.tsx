import { render, screen } from '@testing-library/react'
import { EncryptedBottom } from '.'

describe('EncryptedBottom', () => {
  it('applies custom class names', () => {
    const { container } = render(<EncryptedBottom className="custom-class" />)
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('passes keys', async () => {
    render(<EncryptedBottom frontTextKey="provider.encrypted.front" backTextKey="provider.encrypted.back" />)
    expect(await screen.findByText(/provider.encrypted.front/i)).toBeInTheDocument()
    expect(await screen.findByText(/provider.encrypted.back/i)).toBeInTheDocument()
  })
})
