import { fireEvent, render, screen } from '@testing-library/react'

import TableSelector from '../table-selector'

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PortalToFollowElemTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('TableSelector', () => {
  it('should render a compact label when only one table is available', () => {
    render(
      <TableSelector
        tables={['users']}
        selectedTable=""
        onTableChange={vi.fn()}
      />,
    )

    expect(screen.getByText('workflow.skillSidebar.sqlitePreview.selectTable')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('should render placeholder styling for multi-table selectors without a selection', () => {
    render(
      <TableSelector
        tables={['users', 'events']}
        selectedTable=""
        onTableChange={vi.fn()}
      />,
    )

    const trigger = screen.getAllByRole('button', { name: /workflow\.skillSidebar\.sqlitePreview\.selectTable/i })[0]
    expect(trigger).toHaveClass('cursor-pointer')
    expect(screen.getByText('workflow.skillSidebar.sqlitePreview.selectTable')).toHaveClass('text-text-tertiary')
  })

  it('should allow selecting a different table', () => {
    const onTableChange = vi.fn()

    render(
      <TableSelector
        tables={['users', 'events']}
        selectedTable="users"
        onTableChange={onTableChange}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /users/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /events/i }))

    expect(onTableChange).toHaveBeenCalledWith('events')
  })

  it('should disable the trigger while loading', () => {
    render(
      <TableSelector
        tables={['users', 'events']}
        selectedTable="users"
        isLoading
        onTableChange={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button', { name: /users/i })[0]).toBeDisabled()
  })
})
