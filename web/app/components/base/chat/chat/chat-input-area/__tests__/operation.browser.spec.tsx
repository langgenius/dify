import type { ChatConfig } from '../../../types'
import type { VoiceRecorder } from '@/app/components/base/voice-input/recorder'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { startVoiceRecorder } from '@/app/components/base/voice-input/recorder'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TransferMethod } from '@/types/app'
import { renderChatOwner } from '../../__tests__/chat-owner-preset'
import Chat from '../../index'

vi.unmock('react-i18next')
// boundary: the component journey runs without Next's route context.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))
// boundary: microphone permission and device capture cannot run in headless component tests.
vi.mock('@/app/components/base/voice-input/recorder', () => ({ startVoiceRecorder: vi.fn() }))

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})

const fileUpload: NonNullable<ChatConfig['file_upload']> = {
  enabled: true,
  number_limits: 3,
  max_length: 3,
  allowed_file_types: ['document'],
  allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  image: {
    enabled: false,
    number_limits: 3,
    detail: 'high',
    transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  },
}
const uploadConfig = createChatConfigFixture({ file_upload: fileUpload })

it('opens the real upload surface, returns keyboard focus on Escape, and enforces readonly and enablement', async () => {
  const screen = await renderChatOwner(
    <div style={{ height: 500 }}>
      <Chat chatList={[]} config={uploadConfig} />
    </div>,
  )
  const trigger = page.getByRole('button', { name: 'Local upload', exact: true })
  await trigger.click()
  const popup = page.getByRole('dialog')
  await expect.element(popup.getByPlaceholder('Enter URL...')).toBeVisible()
  await expect
    .element(popup.getByRole('button', { name: 'Local upload', exact: true }))
    .toBeEnabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(popup).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await screen.rerender(<Chat chatList={[]} config={uploadConfig} readonly />)
  await expect.element(trigger).toBeDisabled()
  await screen.rerender(
    <Chat
      chatList={[]}
      config={createChatConfigFixture({ file_upload: { ...fileUpload, enabled: false } })}
    />,
  )
  await expect.element(trigger).not.toBeInTheDocument()
})

function SendOwner({
  readonly = false,
  disabled = false,
}: {
  readonly?: boolean
  disabled?: boolean
}) {
  const [sent, setSent] = useState('Nothing sent')
  return (
    <div style={{ height: 500 }}>
      <Chat chatList={[]} readonly={readonly} inputDisabled={disabled} onSend={setSent} />
      <output aria-label="Sent message">{sent}</output>
    </div>
  )
}

it('sends the actual draft through the operation and prevents readonly or disabled sends', async () => {
  const screen = await renderChatOwner(<SendOwner />)
  await page.getByRole('textbox').fill('Send this draft')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect
    .element(page.getByRole('status', { name: 'Sent message' }))
    .toHaveTextContent('Send this draft')
  await expect.element(page.getByRole('textbox')).toHaveValue('')
  for (const props of [{ readonly: true }, { disabled: true }]) {
    await screen.rerender(<SendOwner {...props} />)
    await expect.element(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
    await expect
      .element(page.getByRole('status', { name: 'Sent message' }))
      .toHaveTextContent('Send this draft')
  }
})

it('starts real voice UI only while the operation is available and editable', async () => {
  const context = new AudioContext()
  const recorder: VoiceRecorder = {
    analyser: context.createAnalyser(),
    stop: vi.fn(() => new Promise<Blob>(() => {})),
    cancel: vi.fn().mockResolvedValue(undefined),
  }
  vi.mocked(startVoiceRecorder).mockResolvedValue(recorder)
  onTestFinished(() => context.close())
  const config = createChatConfigFixture({ speech_to_text: { enabled: true } })
  const screen = await renderChatOwner(
    <div style={{ height: 500 }}>
      <Chat
        chatList={[]}
        config={config}
        speechToTextTarget={{ type: 'consoleApp', appId: 'app-1' }}
      />
    </div>,
  )
  await page.getByRole('button', { name: 'Voice input' }).click()
  await expect.element(page.getByRole('button', { name: 'Stop recording' })).toBeVisible()
  await expect.element(page.getByText('Speak now...')).toBeVisible()
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect.element(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Stop recording' })).not.toBeInTheDocument()
  await screen.rerender(
    <Chat
      chatList={[]}
      config={config}
      readonly
      speechToTextTarget={{ type: 'consoleApp', appId: 'app-1' }}
    />,
  )
  await expect.element(page.getByRole('button', { name: 'Voice input' })).toBeDisabled()
  await screen.rerender(
    <Chat
      chatList={[]}
      config={createChatConfigFixture()}
      speechToTextTarget={{ type: 'consoleApp', appId: 'app-1' }}
    />,
  )
  await expect.element(page.getByRole('button', { name: 'Voice input' })).not.toBeInTheDocument()
  await screen.rerender(<Chat chatList={[]} config={config} />)
  await expect.element(page.getByRole('button', { name: 'Voice input' })).not.toBeInTheDocument()
})
