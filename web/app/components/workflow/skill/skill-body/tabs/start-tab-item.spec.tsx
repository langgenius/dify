import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import StartTabItem from './start-tab-item'

type StartTabItemProps = ComponentProps<typeof StartTabItem>

const createProps = (overrides: Partial<StartTabItemProps> = {}) => {
  const onClick = vi.fn()
  const props: StartTabItemProps = {
    isActive: false,
    onClick,
    ...overrides,
  }

  return { props, onClick }
}

describe('StartTabItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering behavior for the start tab button and label.
  describe('Rendering', () => {
    it('should render the start tab button with translated label', () => {
      const { props } = createProps()

      render(<StartTabItem {...props} />)

      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.startTab/i })).toBeInTheDocument()
    })

    it('should style the start label as active when isActive is true', () => {
      const { props } = createProps({ isActive: true })

      render(<StartTabItem {...props} />)

      expect(screen.getByText('workflow.skillSidebar.startTab')).toHaveClass('text-text-primary')
    })

    it('should style the start label as inactive when isActive is false', () => {
      const { props } = createProps({ isActive: false })

      render(<StartTabItem {...props} />)

      expect(screen.getByText('workflow.skillSidebar.startTab')).toHaveClass('text-text-tertiary')
    })
  })

  // Clicking the tab should delegate to the callback.
  describe('Interactions', () => {
    it('should call onClick when start tab is clicked', () => {
      const { props, onClick } = createProps()

      render(<StartTabItem {...props} />)
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.startTab/i }))

      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })
})
