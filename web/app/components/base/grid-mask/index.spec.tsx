import { render, screen } from '@testing-library/react'
import GridMask from './index'
import Style from './style.module.css'

describe('GridMask', () => {
  describe('Rendering', () => {
    it('should render children in the content layer', () => {
      render(
        <GridMask>
          <button type="button">Run</button>
        </GridMask>,
      )

      expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
    })

    it('should render wrapper, canvas, gradient and content layers in order', () => {
      const { container } = render(
        <GridMask>
          <span>Content</span>
        </GridMask>,
      )

      const wrapper = container.firstElementChild as HTMLElement
      expect(wrapper).toBeInTheDocument()
      expect(wrapper.children).toHaveLength(3)

      const canvasLayer = wrapper.children[0] as HTMLElement
      const gradientLayer = wrapper.children[1] as HTMLElement
      const contentLayer = wrapper.children[2] as HTMLElement

      expect(canvasLayer).toHaveClass('z-0')
      expect(gradientLayer).toHaveClass('z-[1]')
      expect(contentLayer).toHaveClass('z-[2]')
      expect(contentLayer).toHaveTextContent('Content')
    })
  })

  describe('Props', () => {
    it('should apply wrapperClassName to wrapper element', () => {
      const { container } = render(
        <GridMask wrapperClassName="custom-wrapper">
          <span>Child</span>
        </GridMask>,
      )

      const wrapper = container.firstElementChild as HTMLElement
      expect(wrapper).toHaveClass('custom-wrapper')
      expect(wrapper).toHaveClass('relative')
    })

    it('should apply canvasClassName and grid background class to canvas layer', () => {
      const { container } = render(
        <GridMask canvasClassName="custom-canvas">
          <span>Child</span>
        </GridMask>,
      )

      const wrapper = container.firstElementChild as HTMLElement
      const canvasLayer = wrapper.children[0] as HTMLElement

      expect(canvasLayer).toHaveClass('custom-canvas')
      expect(canvasLayer).toHaveClass(Style.gridBg)
    })

    it('should apply gradientClassName to gradient layer', () => {
      const { container } = render(
        <GridMask gradientClassName="custom-gradient">
          <span>Child</span>
        </GridMask>,
      )

      const wrapper = container.firstElementChild as HTMLElement
      const gradientLayer = wrapper.children[1] as HTMLElement

      expect(gradientLayer).toHaveClass('custom-gradient')
      expect(gradientLayer).toHaveClass('bg-grid-mask-background')
    })
  })

  describe('Edge Cases', () => {
    it('should render correctly without optional className props', () => {
      const { container } = render(
        <GridMask>
          <span>Plain child</span>
        </GridMask>,
      )

      const wrapper = container.firstElementChild as HTMLElement
      const canvasLayer = wrapper.children[0] as HTMLElement
      const gradientLayer = wrapper.children[1] as HTMLElement
      const contentLayer = wrapper.children[2] as HTMLElement

      expect(wrapper).toHaveClass('bg-saas-background')
      expect(canvasLayer).toHaveClass('absolute')
      expect(gradientLayer).toHaveClass('absolute')
      expect(contentLayer).toHaveTextContent('Plain child')
    })
  })
})
