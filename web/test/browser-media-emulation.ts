import { cdp } from 'vite-plus/test/browser'

/**
 * Switch Chromium's real `prefers-reduced-motion` media feature, so CSS and `matchMedia`
 * listeners observe the change. Reset it with `emulateReducedMotion(false)` after the test.
 */
export async function emulateReducedMotion(reduce: boolean) {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }],
  })
}
