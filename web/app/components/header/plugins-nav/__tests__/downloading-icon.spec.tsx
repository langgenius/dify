import { render } from '@testing-library/react'
import DownloadingIcon from '../downloading-icon'

describe('DownloadingIcon', () => {
  it('should render the animated install icon wrapper and svg markup', () => {
    const { container } = render(<DownloadingIcon />)

    const wrapper = container.firstElementChild as HTMLElement
    const svg = container.querySelector('svg.install-icon')

    expect(wrapper).toHaveClass('inline-flex', 'text-components-button-secondary-text')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg?.querySelectorAll('path')).toHaveLength(3)
  })
})
