import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ToggleButton from '../components/toggle-button'

describe('ToggleButton', () => {
  const handleToggle = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render a button', () => {
    render(<ToggleButton expand={true} handleToggle={handleToggle} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should call handleToggle on click', () => {
    render(<ToggleButton expand={true} handleToggle={handleToggle} />)
    fireEvent.click(screen.getByRole('button'))
    expect(handleToggle).toHaveBeenCalledTimes(1)
  })

  it('should have rounded-full styling', () => {
    render(<ToggleButton expand={true} handleToggle={handleToggle} />)
    expect(screen.getByRole('button')).toHaveClass('rounded-full', 'px-1')
  })

  it('should apply custom className', () => {
    render(<ToggleButton expand={false} handleToggle={handleToggle} className="extra" />)
    expect(screen.getByRole('button')).toHaveClass('extra')
  })

  it('should render different icons for expand vs collapse', () => {
    const { container: c1 } = render(<ToggleButton expand={true} handleToggle={handleToggle} />)
    const { container: c2 } = render(<ToggleButton expand={false} handleToggle={handleToggle} />)
    const svg1 = c1.querySelector('svg')!.outerHTML
    const svg2 = c2.querySelector('svg')!.outerHTML
    expect(svg1).not.toEqual(svg2)
  })

  it('should show collapse tooltip on hover when expanded', async () => {
    render(<ToggleButton expand={true} handleToggle={handleToggle} />)
    fireEvent.mouseEnter(screen.getByRole('button'))
    await waitFor(
      () => expect(screen.getByText('layout.sidebar.collapseSidebar')).toBeInTheDocument(),
      { timeout: 2000 },
    )
  })

  it('should show expand tooltip on hover when collapsed', async () => {
    render(<ToggleButton expand={false} handleToggle={handleToggle} />)
    fireEvent.mouseEnter(screen.getByRole('button'))
    await waitFor(
      () => expect(screen.getByText('layout.sidebar.expandSidebar')).toBeInTheDocument(),
      { timeout: 2000 },
    )
  })
})
