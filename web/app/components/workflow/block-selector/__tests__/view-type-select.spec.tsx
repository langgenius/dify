import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ViewType } from '../types'
import ViewTypeSelect from '../view-type-select'

describe('ViewTypeSelect', () => {
  it('exposes the current view as a required single choice', () => {
    render(<ViewTypeSelect viewType={ViewType.flat} onChange={vi.fn()} />)

    expect(screen.getByRole('radiogroup', { name: 'common.operation.view' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'workflow.tabs.listView' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'workflow.tabs.treeView' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('changes the view as arrow-key focus moves', async () => {
    const user = userEvent.setup()

    function ViewTypeSelectHarness() {
      const [viewType, setViewType] = useState<ViewType>(ViewType.flat)
      return <ViewTypeSelect viewType={viewType} onChange={setViewType} />
    }

    render(<ViewTypeSelectHarness />)

    const flatView = screen.getByRole('radio', { name: 'workflow.tabs.listView' })
    const treeView = screen.getByRole('radio', { name: 'workflow.tabs.treeView' })

    await user.tab()
    expect(flatView).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(treeView).toHaveFocus()

    expect(flatView).toHaveAttribute('aria-checked', 'false')
    expect(treeView).toHaveAttribute('aria-checked', 'true')
  })
})
