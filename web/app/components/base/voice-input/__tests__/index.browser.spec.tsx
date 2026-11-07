import type { VoiceRecorder } from '../recorder'
import { useRef, useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { transcribeAudio } from '../api'
import VoiceInput from '../index'
import { startVoiceRecorder } from '../recorder'

vi.mock('../api', () => ({ transcribeAudio: vi.fn() }))
vi.mock('../recorder', () => ({ startVoiceRecorder: vi.fn() }))

const target = { type: 'consoleApp' as const, appId: 'app-123' }
const recorderStop = vi.fn<() => Promise<Blob>>()
const recorderCancel = vi.fn<() => Promise<void>>()
const recorder: VoiceRecorder = {
  analyser: {
    frequencyBinCount: 64,
    getByteFrequencyData: (data: Uint8Array) => data.fill(128),
  } as unknown as AnalyserNode,
  stop: recorderStop,
  cancel: recorderCancel,
}

let beforeTranscribe: () => Promise<unknown>

function VoiceInputCaller() {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('original draft')
  const [error, setError] = useState('')
  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }
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
            setError(reason instanceof Error ? reason.message : 'microphone failed')
          }
        />
      )}
      <output aria-label="Draft text">{draft}</output>
      {error && <div role="alert">{error}</div>}
    </div>
  )
}

const renderCaller = async () => {
  const screen = await render(<VoiceInputCaller />)
  await screen.getByRole('button', { name: 'Start voice input' }).click()
  return screen
}

beforeEach(() => {
  recorderStop
    .mockReset()
    .mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp3' }))
  recorderCancel.mockReset().mockResolvedValue()
  vi.mocked(startVoiceRecorder).mockReset().mockResolvedValue(recorder)
  vi.mocked(transcribeAudio).mockReset().mockResolvedValue({ text: 'transcribed text' })
  beforeTranscribe = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

it('lets the user cancel while microphone permission is pending', async () => {
  let setupSignal: AbortSignal | undefined
  vi.mocked(startVoiceRecorder).mockImplementationOnce((signal) => {
    setupSignal = signal
    return new Promise(() => {})
  })
  const screen = await renderCaller()
  const starting = screen.getByText('common.voiceInput.starting')
  await expect.element(starting).toBeVisible()
  await screen.getByRole('button', { name: 'common.operation.cancel' }).click()

  await expect.element(starting).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Start voice input' })).toBeVisible()
  expect(setupSignal?.aborted).toBe(true)
})

it('discards a late recorder after a public cancel and reopen', async () => {
  let resolveOld!: (value: VoiceRecorder) => void
  const staleCancel = vi.fn().mockResolvedValue(undefined)
  const activeCancel = vi.fn().mockResolvedValue(undefined)
  vi.mocked(startVoiceRecorder)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve
      }),
    )
    .mockResolvedValueOnce({ ...recorder, cancel: activeCancel })

  const screen = await renderCaller()
  await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
  await screen.getByRole('button', { name: 'Start voice input' }).click()
  await expect.element(screen.getByText('common.voiceInput.speaking')).toBeVisible()
  resolveOld({ ...recorder, cancel: staleCancel })

  await expect.poll(() => staleCancel.mock.calls.length).toBe(1)
  expect(activeCancel).not.toHaveBeenCalled()
  await expect.element(screen.getByRole('button', { name: 'common.voiceInput.stop' })).toBeVisible()
})

it('publishes the recorded MP3 through the caller and restores keyboard focus', async () => {
  const screen = await renderCaller()
  const stop = screen.getByRole('button', { name: 'common.voiceInput.stop' })
  await expect.element(stop).toBeVisible()
  await userEvent.keyboard('{Tab}')
  await expect.element(stop).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('transcribed text')

  const [requestTarget, file] = vi.mocked(transcribeAudio).mock.calls[0]!
  expect(requestTarget).toEqual(target)
  expect(file.name).toBe('temp.mp3')
  expect(file.type).toBe('audio/mp3')
  expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2, 3])
  const trigger = screen.getByRole('button', { name: 'Start voice input' })
  await expect.element(trigger).toHaveFocus()
})

it.each(['recorder stop', 'draft save', 'transcription request'] as const)(
  'keeps the original draft when cancelled during %s',
  async (stage) => {
    let release!: () => void
    let requestSignal: AbortSignal | undefined
    if (stage === 'recorder stop') {
      recorderStop.mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp3' }))
        }),
      )
    }
    if (stage === 'draft save') {
      beforeTranscribe = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      )
    }
    if (stage === 'transcription request') {
      vi.mocked(transcribeAudio).mockImplementationOnce((_target, _file, signal) => {
        requestSignal = signal
        return new Promise((resolve) => {
          release = () => resolve({ text: 'late transcript' })
        })
      })
    }

    const screen = await renderCaller()
    await screen.getByRole('button', { name: 'common.voiceInput.stop' }).click()
    await expect.element(screen.getByText('common.voiceInput.converting')).toBeVisible()
    if (stage === 'draft save')
      await expect.poll(() => vi.mocked(beforeTranscribe).mock.calls.length).toBe(1)
    if (stage === 'transcription request')
      await expect.poll(() => vi.mocked(transcribeAudio).mock.calls.length).toBe(1)
    await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
    release()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('original draft')
    await expect.element(screen.getByRole('button', { name: 'Start voice input' })).toBeVisible()
    if (stage !== 'transcription request') expect(transcribeAudio).not.toHaveBeenCalled()
    else expect(requestSignal?.aborted).toBe(true)
  },
)

it('shows a microphone setup failure without replacing the draft', async () => {
  vi.mocked(startVoiceRecorder).mockRejectedValueOnce(
    new DOMException('microphone denied', 'NotAllowedError'),
  )
  const screen = await renderCaller()
  await expect.element(screen.getByRole('alert')).toHaveTextContent('microphone denied')
  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('original draft')
  await expect.element(screen.getByRole('button', { name: 'Start voice input' })).toBeVisible()
})

it('reports a transcription failure without replacing the draft', async () => {
  vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error('API failed'))
  const screen = await renderCaller()
  await screen.getByRole('button', { name: 'common.voiceInput.stop' }).click()
  await expect.element(screen.getByRole('alert')).toHaveTextContent('conversion failed')
  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('original draft')
  await expect.element(screen.getByRole('button', { name: 'Start voice input' })).toBeVisible()
})

it('stops at the ten-minute limit and publishes the visible result', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  let resolveTranscript!: () => void
  vi.mocked(transcribeAudio).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveTranscript = () => resolve({ text: 'transcribed text' })
      }),
  )
  const screen = await renderCaller()
  await expect.element(screen.getByRole('timer')).toHaveTextContent('00:00')
  await vi.advanceTimersByTimeAsync(595_000)
  await expect.element(screen.getByRole('button', { name: 'common.voiceInput.stop' })).toBeVisible()
  await vi.advanceTimersByTimeAsync(5_000)
  await expect.element(screen.getByText('common.voiceInput.converting')).toBeVisible()
  resolveTranscript()
  await expect.element(screen.getByLabelText('Draft text')).toHaveTextContent('transcribed text')
})
