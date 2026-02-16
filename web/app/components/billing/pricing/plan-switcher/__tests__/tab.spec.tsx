import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Tab from '../tab'

const Icon = ({ isActive }: { isActive: boolean }) => (
  <svg data-testid="tab-icon" data-active={isActive ? 'true' : 'false'} />
)

describe('PlanSwitcherTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render label and icon', () => {
      render(
        <Tab
          Icon={Icon}
          value="cloud"
          label="Cloud"
          isActive={false}
          onClick={vi.fn()}
        />,
      )

      expect(screen.getByText('Cloud')).toBeInTheDocument()
      expect(screen.getByTestId('tab-icon')).toHaveAttribute('data-active', 'false')
    })
  })

  describe('Props', () => {
    it('should call onClick with the provided value', () => {
      const handleClick = vi.fn()
      render(
        <Tab
          Icon={Icon}
          value="self"
          label="Self"
          isActive={false}
          onClick={handleClick}
        />,
      )

      fireEvent.click(screen.getByText('Self'))

      expect(handleClick).toHaveBeenCalledTimes(1)
      expect(handleClick).toHaveBeenCalledWith('self')
    })

    it('should apply distinct styling when isActive is true', () => {
      const { rerender } = render(
        <Tab
          Icon={Icon}
          value="cloud"
          label="Cloud"
          isActive={false}
          onClick={vi.fn()}
        />,
      )

      const inactiveClassName = screen.getByText('Cloud').className

      rerender(
        <Tab
          Icon={Icon}
          value="cloud"
          label="Cloud"
          isActive
          onClick={vi.fn()}
        />,
      )

      const activeClassName = screen.getByText('Cloud').className
      expect(activeClassName).not.toBe(inactiveClassName)
      expect(screen.getByTestId('tab-icon')).toHaveAttribute('data-active', 'true')
    })
  })

  describe('Edge Cases', () => {
    it('should render when label is empty', () => {
      const { container } = render(
        <Tab
          Icon={Icon}
          value="cloud"
          label=""
          isActive={false}
          onClick={vi.fn()}
        />,
      )

      const label = container.querySelector('span')
      expect(label).toBeInTheDocument()
      expect(label?.textContent).toBe('')
    })
  })
})
