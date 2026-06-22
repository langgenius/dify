import { render } from '@testing-library/react'
import DownloadingIcon from '../downloading-icon'

describe('DownloadingIcon', () => {
  it('should render the animated install icon wrapper and svg markup', () => {
    const { container } = render(<DownloadingIcon />)

    const wrapper = container.firstElementChild as HTMLElement
    const svg = container.querySelector('svg.install-icon')

    expect(wrapper).toHaveClass('inline-flex', 'size-4', 'text-components-button-secondary-text')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg?.querySelectorAll('path')).toHaveLength(3)
  })

  it('should render the same install glyph with a neutral center dot when inactive', () => {
    const { container } = render(<DownloadingIcon active={false} />)

    const centerDot = container.querySelectorAll('path')[1]
    expect(centerDot).toHaveAttribute('fill', 'currentColor')
  })
})
