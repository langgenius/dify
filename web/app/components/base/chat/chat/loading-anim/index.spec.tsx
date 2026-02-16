import { render } from '@testing-library/react'
import LoadingAnim from './index'

describe('LoadingAnim', () => {
  it('should render correctly with text type', () => {
    const { container } = render(<LoadingAnim type="text" />)
    const element = container.firstChild as HTMLElement

    expect(element).toBeInTheDocument()
    expect(element.className).toMatch(/dot-flashing/)
    expect(element.className).toMatch(/text/)
  })

  it('should render correctly with avatar type', () => {
    const { container } = render(<LoadingAnim type="avatar" />)
    const element = container.firstChild as HTMLElement

    expect(element).toBeInTheDocument()
    expect(element.className).toMatch(/dot-flashing/)
    expect(element.className).toMatch(/avatar/)
  })
})
