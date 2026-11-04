import type { Features } from '../../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { FeaturesProvider } from '../../../context'
import VoiceSettings from '../voice-settings'

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/app/test-app-id/configuration',
  useParams: () => ({ appId: 'test-app-id' }),
}))
vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: () => ({ getAudioPlayer: () => ({ playAudio: vi.fn(), pauseAudio: vi.fn() }) }),
  },
}))

const defaultFeatures: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: true, language: 'en-US', voice: 'alloy' },
  speech2text: { enabled: false },
  citation: { enabled: false },
  moderation: { enabled: false },
  file: { enabled: false },
  annotationReply: { enabled: false },
}

function Settings({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <VoiceSettings
      open={open}
      onOpen={setOpen}
      disabled={disabled}
      trigger={<button>Settings</button>}
    />
  )
}
function setup(disabled = false) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.textToAudio.voices.get.queryOptions({
      input: { params: { app_id: 'test-app-id' }, query: { language: 'en-US' } },
    }).queryKey,
    [
      { name: 'Alloy', value: 'alloy' },
      { name: 'Echo', value: 'echo' },
    ],
  )
  return renderWithConsoleQuery(
    <FeaturesProvider features={defaultFeatures}>
      <Settings disabled={disabled} />
    </FeaturesProvider>,
    { queryClient },
  )
}

it('keeps the selected voice when settings are closed and reopened', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole('button', { name: 'Settings' }))
  await user.click(await screen.findByRole('combobox', { name: /voiceSettings.voice/ }))
  await user.click(await screen.findByRole('option', { name: 'Echo' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Settings' }))
  expect(await screen.findByRole('combobox', { name: /voiceSettings.voice/ })).toHaveTextContent(
    'Echo',
  )
})

it('does not open settings while disabled', async () => {
  const user = userEvent.setup()
  setup(true)
  await user.click(screen.getByRole('button', { name: 'Settings' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
