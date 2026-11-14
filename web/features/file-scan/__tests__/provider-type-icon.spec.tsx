import { render } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { ProviderTypeIcon } from '../provider-type-icon'

describe('ProviderTypeIcon', () => {
  it.each([
    ['clamav', '/images/file-scan/clamav.png'],
    ['cloudmersive', '/images/file-scan/cloudmersive.png'],
    ['scanii', '/images/file-scan/scanii.svg'],
    ['metadefender', '/images/file-scan/metadefender.png'],
  ] as const)('shows the %s brand logo', (type, path) => {
    const { container } = render(<ProviderTypeIcon type={type} />)

    const logo = container.querySelector('img')
    expect(logo).toHaveAttribute('src', expect.stringContaining(path))
    // Decorative: the type name is always shown next to it.
    expect(logo).toHaveAttribute('alt', '')
  })

  it('keeps a generic icon for a custom endpoint, which has no brand', () => {
    const { container } = render(<ProviderTypeIcon type="api" />)

    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(container.querySelector('.i-ri-plug-line')).toBeInTheDocument()
  })
})
