import { userEvent } from 'vite-plus/test/browser'
import { renderBillingSettings } from './billing-browser-fixture'

it('keeps View Plan exposed when keyboard focus scrolls back from the bottom of Billing', async () => {
  const { dialog, viewPlan, viewport } = await renderBillingSettings()

  // Native scroll-on-focus previously placed View Plan underneath the sticky Billing heading.
  // The unit tests cannot establish whether a focused control is actually covered.
  await userEvent.keyboard('{End}')
  await expect
    .poll(() => viewport.scrollTop + viewport.clientHeight)
    .toBeGreaterThanOrEqual(viewport.scrollHeight - 1)
  await userEvent.tab()
  await expect.element(viewPlan).toHaveFocus()

  const description = dialog.getByText(
    'Only team owner and team admin can subscribe and view billing information',
  )
  await expect.element(description).toBeVisible()
  const actionRect = viewPlan.element().getBoundingClientRect()
  const descriptionRect = description.element().getBoundingClientRect()
  expect(actionRect.top).toBeGreaterThanOrEqual(descriptionRect.bottom)
  expect(actionRect.bottom).toBeLessThanOrEqual(window.innerHeight)
  const hit = document.elementFromPoint(
    actionRect.left + actionRect.width / 2,
    actionRect.top + actionRect.height / 2,
  )
  expect(viewPlan.element().contains(hit)).toBe(true)
})
