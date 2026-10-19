import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { WorkflowVersionFilterOptions } from '../../../../types'
import Filter from '../index'

it('changes the author filter and named-version restriction through the popover', async () => {
  const user = userEvent.setup()
  const onFilter = vi.fn()
  const onNamed = vi.fn()
  function Harness() {
    const [filter, setFilter] = useState<WorkflowVersionFilterOptions>(
      WorkflowVersionFilterOptions.all,
    )
    const [named, setNamed] = useState(false)
    return (
      <Filter
        filterValue={filter}
        isOnlyShowNamedVersions={named}
        onClickFilterItem={(next) => {
          setFilter(next)
          onFilter(next)
        }}
        handleSwitch={(next) => {
          setNamed(next)
          onNamed(next)
        }}
      />
    )
  }
  render(<Harness />)
  await user.click(screen.getByRole('button'))
  const yours = screen.getByRole('button', {
    name: 'workflowHistory.versionHistory.filter.onlyYours',
  })
  await user.click(yours)
  expect(onFilter).toHaveBeenCalledWith(WorkflowVersionFilterOptions.onlyYours)
  expect(yours).toHaveAttribute('aria-pressed', 'true')

  const named = screen.getByRole('switch')
  await user.click(named)
  expect(onNamed).toHaveBeenCalledWith(true)
  expect(named).toHaveAttribute('aria-checked', 'true')
})
