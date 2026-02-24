import { render } from '@testing-library/react'
import SimplePieChart from '.'

describe('SimplePieChart', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<SimplePieChart />)
      const chart = container.querySelector('.echarts-for-react')
      expect(chart).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<SimplePieChart className="custom-chart" />)
      const chart = container.querySelector('.echarts-for-react')
      expect(chart).toHaveClass('custom-chart')
    })

    it('should apply custom size via style', () => {
      const { container } = render(<SimplePieChart size={24} />)
      const chart = container.querySelector('.echarts-for-react') as HTMLElement
      expect(chart).toHaveStyle({ width: '24px', height: '24px' })
    })

    it('should apply default size of 12', () => {
      const { container } = render(<SimplePieChart />)
      const chart = container.querySelector('.echarts-for-react') as HTMLElement
      expect(chart).toHaveStyle({ width: '12px', height: '12px' })
    })

    it('should set custom fill color as CSS variable', () => {
      const { container } = render(<SimplePieChart fill="red" />)
      const chart = container.querySelector('.echarts-for-react') as HTMLElement
      expect(chart.style.getPropertyValue('--simple-pie-chart-color')).toBe('red')
    })

    it('should set default fill color as CSS variable', () => {
      const { container } = render(<SimplePieChart />)
      const chart = container.querySelector('.echarts-for-react') as HTMLElement
      expect(chart.style.getPropertyValue('--simple-pie-chart-color')).toBe('#fdb022')
    })
  })
})
