import { render } from 'vitest-browser-react'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '../index'

function renderTabs(dir?: 'rtl', disabled = false) {
  return render(
    <div dir={dir}>
      <Tabs defaultValue="overview">
        <TabsList aria-label="Sections">
          <TabsTab value="overview" disabled={disabled}>
            Overview
          </TabsTab>
          <TabsTab value="activity">Recent activity</TabsTab>
          <TabsIndicator data-testid="indicator" />
        </TabsList>
        <TabsPanel value="overview">Overview panel</TabsPanel>
        <TabsPanel value="activity">Activity panel</TabsPanel>
      </Tabs>
    </div>,
  )
}

function offsetFrom(indicator: Element, tab: Element) {
  const indicatorRect = indicator.getBoundingClientRect()
  const tabRect = tab.getBoundingClientRect()
  return Math.max(
    Math.abs(indicatorRect.left - tabRect.left),
    Math.abs(indicatorRect.width - tabRect.width),
    Math.abs(indicatorRect.bottom - tabRect.bottom),
  )
}

describe('TabsIndicator', () => {
  it.each([undefined, 'rtl'] as const)('underlines the active tab (dir: %s)', async (dir) => {
    const screen = await renderTabs(dir)
    const indicator = screen.getByTestId('indicator')
    const overview = screen.getByRole('tab', { name: 'Overview' })
    const activity = screen.getByRole('tab', { name: 'Recent activity' })

    await expect.element(indicator).toBeVisible()
    await expect.poll(() => offsetFrom(indicator.element(), overview.element())).toBeLessThan(1)
    expect(indicator.element().getBoundingClientRect().height).toBe(2)

    await activity.click()
    await expect.element(activity).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => offsetFrom(indicator.element(), activity.element())).toBeLessThan(1)
  })

  it('slides to the next tab and stays out of the accessibility tree', async () => {
    const screen = await renderTabs()
    const indicator = screen.getByTestId('indicator').element() as HTMLElement

    expect(indicator).toHaveAttribute('role', 'presentation')
    expect(getComputedStyle(indicator).pointerEvents).toBe('none')

    await screen.getByRole('tab', { name: 'Recent activity' }).click()

    await expect
      .poll(() =>
        indicator
          .getAnimations()
          .map((animation) => (animation as CSSTransition).transitionProperty),
      )
      .toEqual(expect.arrayContaining(['translate', 'width']))
  })

  it('fades with the active tab when it is disabled', async () => {
    const screen = await renderTabs(undefined, true)
    const indicator = screen.getByTestId('indicator')

    await expect.element(indicator).toBeVisible()
    expect(getComputedStyle(indicator.element()).opacity).toBe(
      getComputedStyle(screen.getByRole('tab', { name: 'Overview' }).element()).opacity,
    )

    await screen.getByRole('tab', { name: 'Recent activity' }).click()
    await expect.poll(() => getComputedStyle(indicator.element()).opacity).toBe('1')
  })
})
