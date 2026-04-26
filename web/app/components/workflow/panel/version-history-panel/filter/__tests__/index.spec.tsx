import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowVersionFilterOptions } from '../../../../types'
import FilterItem from '../filter-item'
import FilterSwitch from '../filter-switch'
import Filter from '../index'

describe('VersionHistory Filter Components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The standalone switch should reflect state and emit checked changes.
  describe('FilterSwitch', () => {
    it('should render the switch label and emit toggled value', async () => {
      const user = userEvent.setup()
      const handleSwitch = vi.fn()

      render(<FilterSwitch enabled={false} handleSwitch={handleSwitch} />)

      expect(screen.getByText('workflow.versionHistory.filter.onlyShowNamedVersions')).toBeInTheDocument()
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')

      await user.click(screen.getByRole('switch'))

      expect(handleSwitch).toHaveBeenCalledWith(true)
    })
  })

  // Filter items should show the current selection and forward the option key.
  describe('FilterItem', () => {
    it('should call onClick with the selected filter key', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()

      const { container } = render(
        <FilterItem
          item={{
            key: WorkflowVersionFilterOptions.onlyYours,
            name: 'Only Yours',
          }}
          isSelected
          onClick={onClick}
        />,
      )

      expect(screen.getByText('Only Yours')).toBeInTheDocument()
      expect(container.querySelector('svg')).toBeInTheDocument()

      await user.click(screen.getByText('Only Yours'))

      expect(onClick).toHaveBeenCalledWith(WorkflowVersionFilterOptions.onlyYours)
    })
  })

  // The composed filter popover should open, list options, and delegate actions.
  describe('Filter', () => {
    it('should open the menu and forward option and switch actions', async () => {
      const user = userEvent.setup()
      const onClickFilterItem = vi.fn()
      const handleSwitch = vi.fn()

      const { container } = render(
        <Filter
          filterValue={WorkflowVersionFilterOptions.all}
          isOnlyShowNamedVersions={false}
          onClickFilterItem={onClickFilterItem}
          handleSwitch={handleSwitch}
        />,
      )

      const trigger = container.querySelector('.h-6.w-6')
      if (!trigger)
        throw new Error('Expected filter trigger to exist')

      await user.click(trigger)

      expect(screen.getByText('workflow.versionHistory.filter.all')).toBeInTheDocument()
      expect(screen.getByText('workflow.versionHistory.filter.onlyYours')).toBeInTheDocument()

      await user.click(screen.getByText('workflow.versionHistory.filter.onlyYours'))
      expect(onClickFilterItem).toHaveBeenCalledWith(WorkflowVersionFilterOptions.onlyYours)

      fireEvent.click(screen.getByRole('switch'))
      expect(handleSwitch).toHaveBeenCalledWith(true)
    })

    it('should mark the trigger as active when a filter is applied', () => {
      const { container } = render(
        <Filter
          filterValue={WorkflowVersionFilterOptions.onlyYours}
          isOnlyShowNamedVersions={false}
          onClickFilterItem={vi.fn()}
          handleSwitch={vi.fn()}
        />,
      )

      expect(container.querySelector('.bg-state-accent-active-alt')).toBeInTheDocument()
      expect(container.querySelector('.text-text-accent')).toBeInTheDocument()
    })
  })
})
