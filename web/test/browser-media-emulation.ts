import { onTestFinished } from 'vite-plus/test'
import { cdp } from 'vite-plus/test/browser'

// Keep in sync with the browser project's provider options in `web/vite.config.ts`.
const defaultReducedMotion = true

async function setReducedMotion(reduce: boolean) {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }],
  })
}

async function setTimezone(timezoneId: string) {
  await cdp().send('Emulation.setTimezoneOverride', { timezoneId })
}

/**
 * Switch Chromium's real `prefers-reduced-motion` media feature, so CSS and `matchMedia`
 * listeners observe the change. Browser specs run with reduced motion; pass `false` when full
 * motion is the contract. The default returns when the test finishes.
 */
export async function emulateReducedMotion(reduce: boolean) {
  onTestFinished(() => setReducedMotion(defaultReducedMotion))
  await setReducedMotion(reduce)
}

/**
 * Switch the browser's own time zone, as `Intl` and `Date` report it. Browser specs run in
 * UTC; the default returns when the test finishes.
 */
export async function emulateTimezone(timezoneId: string) {
  // An empty id clears the override and returns to the browser's `TZ`.
  onTestFinished(() => setTimezone(''))
  await setTimezone(timezoneId)
}
