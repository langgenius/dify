import { render } from '@testing-library/react'
import CustomEdgeLinearGradientRender from '../custom-edge-linear-gradient-render'

describe('CustomEdgeLinearGradientRender', () => {
  it('should render gradient definition with the provided id and positions', () => {
    const { container } = render(
      <svg>
        <CustomEdgeLinearGradientRender
          id="edge-gradient"
          startColor="#123456"
          stopColor="#abcdef"
          position={{
            x1: 10,
            y1: 20,
            x2: 30,
            y2: 40,
          }}
        />
      </svg>,
    )

    const gradient = container.querySelector('linearGradient')
    expect(gradient).toHaveAttribute('id', 'edge-gradient')
    expect(gradient).toHaveAttribute('gradientUnits', 'userSpaceOnUse')
    expect(gradient).toHaveAttribute('x1', '10')
    expect(gradient).toHaveAttribute('y1', '20')
    expect(gradient).toHaveAttribute('x2', '30')
    expect(gradient).toHaveAttribute('y2', '40')
  })

  it('should render start and stop colors at both ends of the gradient', () => {
    const { container } = render(
      <svg>
        <CustomEdgeLinearGradientRender
          id="gradient-colors"
          startColor="#111111"
          stopColor="#222222"
          position={{
            x1: 0,
            y1: 0,
            x2: 100,
            y2: 100,
          }}
        />
      </svg>,
    )

    const stops = container.querySelectorAll('stop')
    expect(stops).toHaveLength(2)
    expect(stops[0]).toHaveAttribute('offset', '0%')
    expect(stops[0].getAttribute('style')).toContain('stop-color: #111111')
    expect(stops[0].getAttribute('style')).toContain('stop-opacity: 1')
    expect(stops[1]).toHaveAttribute('offset', '100%')
    expect(stops[1].getAttribute('style')).toContain('stop-color: #222222')
    expect(stops[1].getAttribute('style')).toContain('stop-opacity: 1')
  })
})
