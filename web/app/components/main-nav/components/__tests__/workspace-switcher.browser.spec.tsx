import type { TenantListItemResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { WorkspaceSwitcher } from '../workspace-switcher'

const workspaces: TenantListItemResponse[] = [
  {
    id: 'workspace-current',
    name: 'Solar Studio',
    plan: 'sandbox',
    status: 'normal',
    created_at: 2,
    current: true,
  },
  {
    id: 'workspace-other',
    name: 'Solar Studio',
    plan: 'team',
    status: 'normal',
    created_at: 1,
    current: false,
  },
]

describe('WorkspaceSwitcher visual states', () => {
  it('keeps current, hover, and focus-visible as independent states', async () => {
    // Chromium owns the rendered hover/focus-visible output that happy-dom cannot reproduce.
    const screen = await render(
      <WorkspaceSwitcher workspaces={workspaces} isPending={false} onSwitchWorkspace={vi.fn()} />,
    )
    const workspaceList = screen.getByRole('list', { name: 'common.userProfile.workspace' })
    const workspaceItems = workspaceList.getByRole('listitem')
    const current = workspaceItems.nth(0).getByRole('button')
    const other = workspaceItems.nth(1).getByRole('button')
    const captureList = () => page.screenshot({ element: workspaceList, save: false })

    const currentResting = await page.screenshot({ element: current, save: false })
    const otherResting = await page.screenshot({ element: other, save: false })
    expect(currentResting).not.toBe(otherResting)

    const resting = await captureList()

    await other.hover()
    const hover = await captureList()
    expect(hover).not.toBe(resting)

    await userEvent.unhover(other)
    await current.hover()
    const currentHover = await captureList()
    expect(currentHover).not.toBe(resting)
    expect(currentHover).not.toBe(hover)

    await userEvent.unhover(current)
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.tab()
    expect(current.element()).toHaveFocus()
    const focusVisible = await captureList()
    expect(focusVisible).not.toBe(resting)
    expect(focusVisible).not.toBe(currentHover)
  })
})
