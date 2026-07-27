import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SVGBtn from '..'

describe('SVGBtn', () => {
  it('toggles SVG mode when clicked', async () => {
    const user = userEvent.setup()
    const setIsSVG = vi.fn()
    render(<SVGBtn isSVG={false} setIsSVG={setIsSVG} />)

    await user.click(screen.getByRole('button'))

    expect(setIsSVG).toHaveBeenCalledOnce()
    expect(setIsSVG.mock.calls[0]![0](false)).toBe(true)
  })
})
