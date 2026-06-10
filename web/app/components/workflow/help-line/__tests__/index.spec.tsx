import { render } from '@testing-library/react'
import HelpLine from '../index'

const mockUseViewport = vi.hoisted(() => vi.fn())
const mockUseStore = vi.hoisted(() => vi.fn())

vi.mock('reactflow', () => ({
  useViewport: () => mockUseViewport(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: {
    helpLineHorizontal?: { top: number, left: number, width: number }
    helpLineVertical?: { top: number, left: number, height: number }
  }) => unknown) => mockUseStore(selector),
}))

describe('HelpLine', () => {
  let helpLineHorizontal: { top: number, left: number, width: number } | undefined
  let helpLineVertical: { top: number, left: number, height: number } | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    helpLineHorizontal = undefined
    helpLineVertical = undefined

    mockUseViewport.mockReturnValue({ x: 10, y: 20, zoom: 2 })
    mockUseStore.mockImplementation((selector: (state: {
      helpLineHorizontal?: { top: number, left: number, width: number }
      helpLineVertical?: { top: number, left: number, height: number }
    }) => unknown) => selector({
      helpLineHorizontal,
      helpLineVertical,
    }))
  })

  it('should render nothing when both help lines are absent', () => {
    const { container } = render(<HelpLine />)

    expect(container).toBeEmptyDOMElement()
  })

  it('should render the horizontal and vertical guide lines using viewport offsets and zoom', () => {
    helpLineHorizontal = { top: 30, left: 40, width: 50 }
    helpLineVertical = { top: 60, left: 70, height: 80 }

    const { container } = render(<HelpLine />)
    const [horizontal, vertical] = Array.from(container.querySelectorAll('div'))

    expect(horizontal).toHaveStyle({
      top: '80px',
      left: '90px',
      width: '100px',
    })
    expect(vertical).toHaveStyle({
      top: '140px',
      left: '150px',
      height: '160px',
    })
  })
})
