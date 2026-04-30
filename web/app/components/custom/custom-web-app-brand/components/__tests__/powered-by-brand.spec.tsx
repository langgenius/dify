import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PoweredByBrand from '../powered-by-brand'

describe('PoweredByBrand', () => {
  it('should render the workspace logo when available', () => {
    render(
      <PoweredByBrand
        imgKey={1}
        workspaceLogo="https://example.com/workspace-logo.png"
        webappLogo="https://example.com/custom-logo.png"
      />,
    )

    expect(screen.getByText('POWERED BY')).toBeInTheDocument()
    expect(screen.getByAltText('logo')).toHaveAttribute('src', 'https://example.com/workspace-logo.png')
  })

  it('should fall back to the custom web app logo when workspace branding is unavailable', () => {
    render(
      <PoweredByBrand
        imgKey={42}
        webappLogo="https://example.com/custom-logo.png"
      />,
    )

    expect(screen.getByAltText('logo')).toHaveAttribute('src', 'https://example.com/custom-logo.png?hash=42')
  })

  it('should fall back to the Dify logo when no custom branding exists', () => {
    render(<PoweredByBrand imgKey={7} />)

    expect(screen.getByAltText('Dify logo')).toBeInTheDocument()
  })

  it('should render nothing when branding is removed', () => {
    const { container } = render(<PoweredByBrand imgKey={7} webappBrandRemoved />)

    expect(container).toBeEmptyDOMElement()
  })
})
