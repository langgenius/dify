import { fireEvent, render, screen } from '@testing-library/react'
import SVGBtn from '.'

describe('SVGBtn', () => {
  describe('Rendering', () => {
    it('renders correctly', () => {
      const setIsSVG = vi.fn()
      render(<SVGBtn isSVG={false} setIsSVG={setIsSVG} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('calls setIsSVG with a toggle function when clicked', () => {
      const setIsSVG = vi.fn()
      render(<SVGBtn isSVG={false} setIsSVG={setIsSVG} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(setIsSVG).toHaveBeenCalledTimes(1)
      const toggleFunc = setIsSVG.mock.calls[0][0]
      expect(typeof toggleFunc).toBe('function')
      expect(toggleFunc(false)).toBe(true)
      expect(toggleFunc(true)).toBe(false)
    })
  })

  describe('Props', () => {
    it('applies correct class when isSVG is false', () => {
      const setIsSVG = vi.fn()
      render(<SVGBtn isSVG={false} setIsSVG={setIsSVG} />)
      const icon = screen.getByRole('button').firstChild as HTMLElement
      expect(icon?.className).toMatch(/_svgIcon_\w+/)
    })

    it('applies correct class when isSVG is true', () => {
      const setIsSVG = vi.fn()
      render(<SVGBtn isSVG={true} setIsSVG={setIsSVG} />)
      const icon = screen.getByRole('button').firstChild as HTMLElement
      expect(icon?.className).toMatch(/_svgIconed_\w+/)
    })
  })
})
