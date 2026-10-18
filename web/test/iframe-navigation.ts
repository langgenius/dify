import type { Window } from 'happy-dom'
import { afterEach, beforeEach } from 'vite-plus/test'

// Stop the emulator loading remote documents while preserving src, contentWindow,
// and production origin checks. This does not simulate browser message delivery.
export function disableIframeNavigation() {
  const navigation = (window as unknown as Window).happyDOM.settings.navigation
  let original: boolean
  beforeEach(() => {
    original = navigation.disableChildFrameNavigation
    navigation.disableChildFrameNavigation = true
  })
  afterEach(() => {
    navigation.disableChildFrameNavigation = original
  })
}
