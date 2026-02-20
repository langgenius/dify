import { render, screen } from '@testing-library/react'
import GridMask from './index'
import Style from './style.module.css'

function renderGridMask(props: Partial<React.ComponentProps<typeof GridMask>> = {}, children: React.ReactNode = <span>Child</span>) {
  const { container } = render(<GridMask {...props}>{children}</GridMask>)
  const wrapper = container.firstElementChild as HTMLElement
  const canvasLayer = wrapper.children[0] as HTMLElement
  const gradientLayer = wrapper.children[1] as HTMLElement
  const contentLayer = wrapper.children[2] as HTMLElement
  return { container, wrapper, canvasLayer, gradientLayer, contentLayer }
}

describe('GridMask', () => {
  describe('Rendering', () => {
    it('should render children in the content layer', () => {
      renderGridMask({}, <button>Run</button>)
      expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
    })

    it('should render correctly without optional className props', () => {
      const { wrapper, canvasLayer, gradientLayer, contentLayer } = renderGridMask({}, <span>Plain child</span>)

      expect(wrapper).toHaveClass('bg-saas-background')
      expect(canvasLayer).toHaveClass('absolute')
      expect(gradientLayer).toHaveClass('absolute')
      expect(contentLayer).toHaveTextContent('Plain child')
    })

    it('should render wrapper, canvas, gradient and content layers in order', () => {
      const { wrapper, canvasLayer, gradientLayer, contentLayer } = renderGridMask({}, <span>Content</span>)
      expect(wrapper).toBeInTheDocument()
      expect(wrapper.children).toHaveLength(3)
      expect(canvasLayer).toHaveClass('z-0')
      expect(gradientLayer).toHaveClass('z-[1]')
      expect(contentLayer).toHaveClass('z-[2]')
      expect(contentLayer).toHaveTextContent('Content')
    })
  })

  describe('Props', () => {
    it('should apply wrapperClassName to wrapper element', () => {
      const { wrapper } = renderGridMask({ wrapperClassName: 'custom-wrapper' }, <span>Child</span>)
      expect(wrapper).toHaveClass('custom-wrapper')
      expect(wrapper).toHaveClass('relative')
    })

    it('should apply canvasClassName and grid background class to canvas layer', () => {
      const { canvasLayer } = renderGridMask({ canvasClassName: 'custom-canvas' }, <span>Child</span>)

      expect(canvasLayer).toHaveClass('custom-canvas')
      expect(canvasLayer).toHaveClass(Style.gridBg)
    })

    it('should apply gradientClassName to gradient layer', () => {
      const { gradientLayer } = renderGridMask({ gradientClassName: 'custom-gradient' }, <span>Child</span>)

      expect(gradientLayer).toHaveClass('custom-gradient')
      expect(gradientLayer).toHaveClass('bg-grid-mask-background')
    })
  })
})
