import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SVGBtn from '..'

describe('SVGBtn', () => {
  it('exposes and toggles the SVG preview state', async () => {
    const user = userEvent.setup()
    const setIsSVG = vi.fn()
    const { rerender } = render(<SVGBtn isSVG={false} setIsSVG={setIsSVG} />)

    await user.click(screen.getByRole('button', { name: 'SVG', pressed: false }))

    expect(setIsSVG).toHaveBeenCalledOnce()
    expect(setIsSVG.mock.calls[0]![0](false)).toBe(true)

    rerender(<SVGBtn isSVG setIsSVG={setIsSVG} />)

    expect(screen.getByRole('button', { name: 'SVG', pressed: true })).toBeInTheDocument()
  })
})
