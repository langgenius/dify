import { userEvent } from 'vite-plus/test/browser'
import { renderBillingSettings } from './billing-browser-fixture'

it('shows a visible keyboard focus indicator on the scrollable Billing panel', async () => {
  const { preferences, viewport } = await renderBillingSettings()

  await userEvent.tab({ shift: true })
  await expect.element(preferences).toHaveFocus()
  const unfocusedShadow = getComputedStyle(viewport).boxShadow

  // The shared ScrollArea removes the browser outline; only real rendering proves that the
  // Settings owner supplies a visible replacement on this keyboard-operable scroll target.
  await userEvent.tab()
  expect(document.activeElement).toBe(viewport)
  expect(viewport.matches(':focus-visible')).toBe(true)
  const focusedStyle = getComputedStyle(viewport)
  expect(focusedStyle.boxShadow).not.toBe('none')
  expect(focusedStyle.boxShadow).not.toBe(unfocusedShadow)
  const rect = viewport.getBoundingClientRect()
  expect(rect.top).toBeGreaterThanOrEqual(0)
  expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight)
})
