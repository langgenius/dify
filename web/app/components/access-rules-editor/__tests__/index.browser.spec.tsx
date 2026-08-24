import type { ResourceUserAccessSetting } from '@/models/access-control'
import { render } from 'vitest-browser-react'
import AccessRulesEditor from '../index'

const userAccessSettings: ResourceUserAccessSetting[] = Array.from({ length: 20 }, (_, index) => ({
  account: {
    account_id: `account-${index + 1}`,
    account_name: `Member ${index + 1}`,
    email: `member-${index + 1}@example.com`,
  },
  roles: [],
  access_policies: [],
}))

describe('AccessRulesEditor scrolling', () => {
  it('keeps the table header and pagination outside the scrollable member rows', async () => {
    // Chromium owns table row-group overflow and geometry; happy-dom cannot prove this boundary.
    const screen = await render(
      <div className="flex" style={{ height: 480, width: 880 }}>
        <AccessRulesEditor
          className="min-h-0 flex-1"
          rules={[]}
          userAccessSettings={userAccessSettings}
          isLoadingRules={false}
          isLoadingUserAccessSettings={false}
          automaticIncludeWorkspaceMembers={false}
          isUpdatingAutomaticIncludeWorkspaceMembers={false}
          currentPage={1}
          totalPages={2}
          updatingAccountId={null}
          onPageChange={vi.fn()}
        />
      </div>,
    )
    const rowGroups = await screen.getByRole('rowgroup').all()
    const columnHeaders = await screen.getByRole('columnheader').all()
    const cells = await screen.getByRole('cell').all()
    const header = rowGroups[0]!.element()
    const memberRows = rowGroups[1]!.element()
    const nextPageButton = screen.getByRole('button', { name: 'common.pagination.next' }).element()

    await vi.waitFor(() => {
      expect(memberRows.scrollHeight).toBeGreaterThan(memberRows.clientHeight)
    })
    columnHeaders.forEach((columnHeader, index) => {
      expect(cells[index]!.element().getBoundingClientRect().left).toBeCloseTo(
        columnHeader.element().getBoundingClientRect().left,
        0,
      )
    })
    const headerTop = header.getBoundingClientRect().top
    const paginationTop = nextPageButton.getBoundingClientRect().top

    memberRows.scrollTop = memberRows.scrollHeight
    memberRows.dispatchEvent(new Event('scroll'))

    await vi.waitFor(() => {
      expect(memberRows.scrollTop).toBeGreaterThan(0)
    })
    expect(header.getBoundingClientRect().top).toBe(headerTop)
    expect(nextPageButton.getBoundingClientRect().top).toBe(paginationTop)
  })
})
