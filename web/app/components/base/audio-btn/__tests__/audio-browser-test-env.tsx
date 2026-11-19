import type { ReactElement } from 'react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import appApi from '@/i18n/locales/en-US/app-api.json'
import { createWavFixture } from '@/test/browser-media'
import { AudioPlayerManager } from '../audio.player.manager'

export async function renderAudio(ui: ReactElement) {
  // The legacy button uses i18next.t directly; both controls share the real English resource.
  await i18next.init({
    lng: 'en-US',
    resources: { 'en-US': { appApi } },
    keySeparator: false,
  })
  return render(<I18nextProvider i18n={i18next}>{ui}</I18nextProvider>)
}

export function audioResponse() {
  const wav = createWavFixture({ duration: 10 })
  wav.revoke()
  return new Response(Uint8Array.from(wav.bytes), { headers: { 'content-type': 'audio/wav' } })
}

/** Seed the real manager before rendering, retaining its native resource for playback assertions. */
export function createNativePlayer(id: string) {
  return AudioPlayerManager.getInstance().getAudioPlayer(
    '/apps/app-1/text-to-audio',
    false,
    id,
    'Read this answer',
    'alloy',
    null,
  )
}

export function destroyPlayer(id: string) {
  AudioPlayerManager.getInstance()
    .getAudioPlayer('', false, id, undefined, undefined, null)
    .destroy()
}

export const audioRoutes: {
  route: string
  params: Record<string, string>
  pathname: string
  url: string
  source: string
}[] = [
  {
    route: 'public',
    params: { token: 'public-token' },
    pathname: '/chat/public-token',
    url: '/text-to-audio',
    source: 'webApp',
  },
  {
    route: 'app',
    params: { appId: 'app-1' },
    pathname: '/apps/app-1/chat',
    url: '/apps/app-1/text-to-audio',
    source: 'installedApp',
  },
  {
    route: 'installed',
    params: { appId: 'app-1' },
    pathname: '/installed/app-1',
    url: '/installed-apps/app-1/text-to-audio',
    source: 'installedApp',
  },
]
