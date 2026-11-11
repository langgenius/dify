import type { consoleClient } from '@/service/console'
import type { MicrophoneFixture } from '@/test/browser-media'
import { useEffect, useRef, useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createMicrophoneFixture, paintedPixelCount } from '@/test/browser-media'
import { createDeferred } from '@/test/deferred'
import VoiceInput from '../index'

// boundary: transcription stops at the generated console HTTP client; no external request is sent.
const api = vi.hoisted(() => ({
  transcribe: vi.fn<typeof consoleClient.apps.byAppId.audioToText.post>(),
}))

// boundary: retain the real transcription adapter while replacing only its generated HTTP transport.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.audioToText.post': api.transcribe,
    }),
  }
})

const target = { type: 'consoleApp' as const, appId: 'app-123' }
const microphones: MicrophoneFixture[] = []
const recorderCloseGates: Array<ReturnType<typeof createDeferred<void>>> = []
let beforeTranscribe: () => Promise<unknown>
let beforeTranscribeCalls = 0

function VoiceInputCaller() {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const restoreFocusAfterCloseRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('original draft')
  const [error, setError] = useState('')
  const close = () => {
    restoreFocusAfterCloseRef.current = true
    setOpen(false)
  }
  useEffect(() => {
    if (open || !restoreFocusAfterCloseRef.current) return
    restoreFocusAfterCloseRef.current = false
    triggerRef.current?.focus()
  }, [open])
  return (
    <div style={{ minHeight: 80, position: 'relative', width: 420 }}>
      {!open && (
        <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
          Start voice input
        </button>
      )}
      {open && (
        <VoiceInput
          target={target}
          onBeforeTranscribe={() => beforeTranscribe()}
          onConverted={setDraft}
          onCancel={close}
          onError={() => setError('conversion failed')}
          onStartError={(reason) =>
            setError(
              reason instanceof Error || reason instanceof DOMException
                ? reason.message
                : 'microphone failed',
            )
          }
        />
      )}
      <output aria-label="Draft text">{draft}</output>
      {error && <div role="alert">{error}</div>}
    </div>
  )
}

const addMicrophone = () => {
  const microphone = createMicrophoneFixture()
  microphones.push(microphone)
  return microphone
}

const resumeMicrophones = () => Promise.all(microphones.map(({ resume }) => resume()))

const renderCaller = async () => {
  const screen = await render(<VoiceInputCaller />)
  await screen.getByRole('button', { name: 'Start voice input' }).click()
  await resumeMicrophones()
  return screen
}

const recordingCanvas = () => document.querySelector('canvas') as HTMLCanvasElement

const waitForRecording = async (screen: Awaited<ReturnType<typeof render>>) => {
  await expect.element(screen.getByText('common.voiceInput.speaking')).toBeVisible()
  await expect.poll(() => paintedPixelCount(recordingCanvas())).toBeGreaterThan(0)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

beforeEach(() => {
  // boundary: provide the default generated-client HTTP response without external network access.
  api.transcribe.mockReset().mockResolvedValue({ text: 'transcribed text' })
  beforeTranscribeCalls = 0
  beforeTranscribe = async () => {
    beforeTranscribeCalls++
  }
  const microphone = addMicrophone()
  // boundary: the test page has no physical microphone; feed the real recorder a native stream.
  vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(microphone.stream)
})

afterEach(async () => {
  recorderCloseGates.splice(0).forEach(({ resolve }) => resolve())
  await Promise.allSettled(microphones.splice(0).map(({ dispose }) => dispose()))
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('lets the user cancel while microphone permission is pending', async () => {
  const pendingMicrophone = createDeferred<MediaStream>()
  // boundary: keep the physical microphone permission request pending until the user cancels.
  vi.mocked(navigator.mediaDevices.getUserMedia)
    .mockReset()
    .mockReturnValue(pendingMicrophone.promise)
  const screen = await renderCaller()
  const starting = screen.getByText('common.voiceInput.starting')
  await expect.element(starting).toBeVisible()
  await expect.poll(() => vi.mocked(navigator.mediaDevices.getUserMedia).mock.calls.length).toBe(1)
  await screen.getByRole('button', { name: 'common.operation.cancel' }).click()

  await expect.element(starting).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Start voice input' })).toBeVisible()
  pendingMicrophone.resolve(microphones[0]!.stream)
  await expect.poll(() => microphones[0]!.track.readyState).toBe('ended')
})

it('releases a late microphone after a public cancel and keeps the reopened session usable', async () => {
  const staleMicrophone = microphones[0]!
  const activeMicrophone = addMicrophone()
  const pendingMicrophone = createDeferred<MediaStream>()
  // boundary: deliver two physical microphone results out of order across public sessions.
  vi.mocked(navigator.mediaDevices.getUserMedia)
    .mockReset()
    .mockReturnValueOnce(pendingMicrophone.promise)
    .mockResolvedValueOnce(activeMicrophone.stream)

  const screen = await renderCaller()
  const starting = screen.getByText('common.voiceInput.starting')
  await expect.element(starting).toBeVisible()
  await expect.poll(() => vi.mocked(navigator.mediaDevices.getUserMedia).mock.calls.length).toBe(1)
  await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(starting).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Start voice input' }).click()
  await resumeMicrophones()
  await waitForRecording(screen)
  pendingMicrophone.resolve(staleMicrophone.stream)

  await expect.element(screen.getByRole('button', { name: 'common.voiceInput.stop' })).toBeVisible()
  await expect.poll(() => staleMicrophone.track.readyState).toBe('ended')
  expect(activeMicrophone.track.readyState).toBe('live')
  await screen.getByRole('button', { name: 'common.voiceInput.stop' }).click()
  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('transcribed text')
})

it('publishes a decodable recorded MP3 through the caller and restores keyboard focus', async () => {
  const screen = await renderCaller()
  const stop = screen.getByRole('button', { name: 'common.voiceInput.stop' })
  await expect.element(stop).toBeVisible()
  await waitForRecording(screen)
  await userEvent.keyboard('{Tab}')
  await expect.element(stop).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('transcribed text')
  await expect.element(screen.getByRole('button', { name: 'Start voice input' })).toHaveFocus()

  const [input] = api.transcribe.mock.calls[0]!
  const file = input.body.file
  expect(input.params).toEqual({ app_id: 'app-123' })
  expect(file).toBeInstanceOf(File)
  const recordedFile = file as File
  expect(recordedFile.name).toBe('temp.mp3')
  expect(file.type).toBe('audio/mp3')
  expect(file.size).toBeGreaterThan(0)
  const decodingContext = new AudioContext()
  try {
    const decoded = await decodingContext.decodeAudioData(await recordedFile.arrayBuffer())
    expect(decoded.duration).toBeGreaterThan(0)
    expect(decoded.numberOfChannels).toBe(1)
  } finally {
    await decodingContext.close()
  }
})

it('keeps the original draft when cancelled during recorder completion', async () => {
  const microphone = microphones[0]!
  const closeGate = createDeferred()
  const nativeClose = AudioContext.prototype.close
  const recorderCloseStarted = createDeferred()
  recorderCloseGates.push(closeGate)
  // boundary: delay completion of native recorder cleanup while invoking native close immediately.
  vi.spyOn(AudioContext.prototype, 'close').mockImplementation(function (this: AudioContext) {
    const nativeCompletion = nativeClose.call(this)
    if (this === microphone.context) return nativeCompletion
    recorderCloseStarted.resolve()
    return Promise.all([nativeCompletion, closeGate.promise]).then(() => undefined)
  })

  const screen = await renderCaller()
  await waitForRecording(screen)
  await screen.getByRole('button', { name: 'common.voiceInput.stop' }).click()
  await expect.element(screen.getByText('common.voiceInput.converting')).toBeVisible()
  await recorderCloseStarted.promise
  expect(microphone.track.readyState).toBe('ended')
  await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
  closeGate.resolve()

  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('original draft')
  await expect.element(screen.getByRole('button', { name: 'Start voice input' })).toBeVisible()
  expect(api.transcribe).not.toHaveBeenCalled()
})

it('keeps the original draft when cancelled during the caller draft-save callback', async () => {
  const draftSave = createDeferred()
  beforeTranscribe = () => {
    beforeTranscribeCalls++
    return draftSave.promise
  }
  const screen = await renderCaller()
  await waitForRecording(screen)
  await screen.getByRole('button', { name: 'common.voiceInput.stop' }).click()
  await expect.element(screen.getByText('common.voiceInput.converting')).toBeVisible()
  await expect.poll(() => beforeTranscribeCalls).toBe(1)
  await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
  draftSave.resolve()
  await draftSave.promise
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('original draft')
  await expect.element(screen.getByRole('button', { name: 'Start voice input' })).toBeVisible()
  expect(api.transcribe).not.toHaveBeenCalled()
})

it('keeps the original draft and aborts HTTP when cancelled during transcription', async () => {
  const response = createDeferred<{ text: string }>()
  // boundary: hold the generated-client HTTP response so cancellation can abort it in flight.
  api.transcribe.mockReturnValueOnce(response.promise)
  const screen = await renderCaller()
  await waitForRecording(screen)
  await screen.getByRole('button', { name: 'common.voiceInput.stop' }).click()
  await expect.element(screen.getByText('common.voiceInput.converting')).toBeVisible()
  await expect.poll(() => api.transcribe.mock.calls.length).toBe(1)
  const oldRequestSignal = api.transcribe.mock.calls[0]![1]?.signal
  await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(screen.getByRole('button', { name: 'Start voice input' })).toBeVisible()

  const reopenedMicrophone = addMicrophone()
  // boundary: a reopened public session receives a fresh native microphone stream.
  vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce(reopenedMicrophone.stream)
  await screen.getByRole('button', { name: 'Start voice input' }).click()
  await resumeMicrophones()
  await waitForRecording(screen)
  response.resolve({ text: 'late transcript' })
  await response.promise
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('original draft')
  await expect.element(screen.getByRole('button', { name: 'common.voiceInput.stop' })).toBeVisible()
  expect(oldRequestSignal?.aborted).toBe(true)
  await screen.getByRole('button', { name: 'common.voiceInput.stop' }).click()
  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('transcribed text')
})

it('shows a microphone setup failure without replacing the draft', async () => {
  // boundary: emulate a physical microphone permission denial from the browser.
  vi.mocked(navigator.mediaDevices.getUserMedia)
    .mockReset()
    .mockRejectedValueOnce(new DOMException('microphone denied', 'NotAllowedError'))
  const screen = await renderCaller()
  await expect.element(screen.getByRole('alert')).toHaveTextContent('microphone denied')
  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('original draft')
  await expect.element(screen.getByRole('button', { name: 'Start voice input' })).toBeVisible()
})

it('reports a transcription transport failure without replacing the draft', async () => {
  // boundary: reject the generated-client HTTP transport without sending an external request.
  api.transcribe.mockRejectedValueOnce(new Error('API failed'))
  const screen = await renderCaller()
  await waitForRecording(screen)
  await screen.getByRole('button', { name: 'common.voiceInput.stop' }).click()
  await expect.element(screen.getByRole('alert')).toHaveTextContent('conversion failed')
  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('original draft')
  await expect.element(screen.getByRole('button', { name: 'Start voice input' })).toBeVisible()
})

it('stops at the ten-minute limit and publishes the visible result', async () => {
  // boundary: advance only the duration interval; native animation frames and audio stay real.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const response = createDeferred<{ text: string }>()
  // boundary: hold the generated-client HTTP response while observing the converting state.
  api.transcribe.mockReturnValueOnce(response.promise)
  const screen = await renderCaller()
  await waitForRecording(screen)
  await expect.element(screen.getByRole('timer')).toHaveTextContent('00:00')
  await vi.advanceTimersByTimeAsync(595_000)
  await expect.element(screen.getByRole('button', { name: 'common.voiceInput.stop' })).toBeVisible()
  await vi.advanceTimersByTimeAsync(5_000)
  await expect.element(screen.getByText('common.voiceInput.converting')).toBeVisible()
  await expect.poll(() => api.transcribe.mock.calls.length).toBe(1)
  response.resolve({ text: 'transcribed text' })
  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('transcribed text')
})
