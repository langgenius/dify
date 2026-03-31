import { render } from '@testing-library/react'
import TracingIcon from '../tracing-icon'

describe('OverviewRouteTracingIcon', () => {
  it('should render the medium icon size classes with custom class names', () => {
    const { container } = render(<TracingIcon size="md" className="custom-class" />)

    expect(container.firstChild).toHaveClass('custom-class', 'w-6', 'h-6', 'p-1', 'rounded-lg', 'bg-primary-500')
  })

  it('should render the large icon size classes', () => {
    const { container } = render(<TracingIcon size="lg" />)

    expect(container.firstChild).toHaveClass('w-9', 'h-9', 'p-2', 'rounded-[10px]')
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})
