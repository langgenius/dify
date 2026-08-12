import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ViewType } from '../types'
import ViewTypeSelect from '../view-type-select'

describe('ViewTypeSelect', () => {
  it('exposes the current view through named toggle buttons', () => {
    render(<ViewTypeSelect viewType={ViewType.flat} onChange={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'common.operation.view' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workflow.tabs.listView' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'workflow.tabs.treeView' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('changes the view with roving focus and keyboard activation', async () => {
    const user = userEvent.setup()

    function ViewTypeSelectHarness() {
      const [viewType, setViewType] = useState<ViewType>(ViewType.flat)
      return <ViewTypeSelect viewType={viewType} onChange={setViewType} />
    }

    render(<ViewTypeSelectHarness />)

    const flatView = screen.getByRole('button', { name: 'workflow.tabs.listView' })
    const treeView = screen.getByRole('button', { name: 'workflow.tabs.treeView' })

    await user.tab()
    expect(flatView).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(treeView).toHaveFocus()

    await user.keyboard(' ')

    expect(flatView).toHaveAttribute('aria-pressed', 'false')
    expect(treeView).toHaveAttribute('aria-pressed', 'true')
  })
})
