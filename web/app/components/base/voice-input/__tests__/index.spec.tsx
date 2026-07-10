import type { VoiceRecorder } from '../recorder'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { transcribeAudio } from '../api'
import VoiceInput from '../index'
import { startVoiceRecorder } from '../recorder'

vi.mock('../api', () => ({ transcribeAudio: vi.fn() }))

vi.mock('../recorder', () => ({
  startVoiceRecorder: vi.fn(),
}))

const recorderStop = vi.fn<() => Promise<Blob>>()
const recorderCancel = vi.fn<() => Promise<void>>()
const getByteFrequencyData = vi.fn()
const recorder: VoiceRecorder = {
  analyser: {
    frequencyBinCount: 8,
    getByteFrequencyData,
  } as unknown as AnalyserNode,
  stop: recorderStop,
  cancel: recorderCancel,
}
const target = {
  type: 'consoleApp' as const,
  appId: 'app-123',
}
const canvasContext = {
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  rect: vi.fn(),
  roundRect: vi.fn(),
  scale: vi.fn(),
  get fillStyle() {
    return ''
  },
  set fillStyle(_value: string) {},
} as unknown as CanvasRenderingContext2D

const renderVoiceInput = (overrides: Partial<React.ComponentProps<typeof VoiceInput>> = {}) => {
  const props: React.ComponentProps<typeof VoiceInput> = {
    onCancel: vi.fn(),
    onBeforeTranscribe: vi.fn().mockResolvedValue(undefined),
    onConverted: vi.fn(),
    onError: vi.fn(),
    onStartError: vi.fn(),
    target,
    ...overrides,
  }
  return { ...render(<VoiceInput {...props} />), props }
}

describe('VoiceInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(startVoiceRecorder).mockResolvedValue(recorder)
    recorderStop.mockResolvedValue(new Blob(['mp3-data'], { type: 'audio/mp3' }))
    recorderCancel.mockResolvedValue()
    vi.mocked(transcribeAudio).mockResolvedValue({ text: 'transcribed text' })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 16,
      height: 16,
      left: 0,
      right: 300,
      top: 0,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  // The component owns the local recording state and browser-resource lifecycle.
  describe('Recording state', () => {
    it('should show the recording state after microphone setup succeeds', async () => {
      renderVoiceInput()

      expect(await screen.findByText('common.voiceInput.speaking')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.voiceInput.stop' })).toBeInTheDocument()
      expect(screen.getByTestId('voice-input-timer')).toHaveTextContent('00:00')
      expect(getByteFrequencyData).toHaveBeenCalledTimes(1)
    })

    it('should report setup failure and close the voice input', async () => {
      vi.mocked(startVoiceRecorder).mockRejectedValueOnce(new Error('microphone denied'))
      const { props } = renderVoiceInput()

      await waitFor(() => expect(props.onStartError).toHaveBeenCalledTimes(1))
      expect(props.onCancel).toHaveBeenCalledTimes(1)
    })

    it('should cancel recorder resources when unmounted', async () => {
      const { unmount } = renderVoiceInput()
      await screen.findByText('common.voiceInput.speaking')

      unmount()

      expect(recorderCancel).toHaveBeenCalledTimes(1)
    })

    it('should discard a stale recorder when effects are replayed', async () => {
      let resolveFirstRecorder: (value: VoiceRecorder) => void = () => {}
      let resolveSecondRecorder: (value: VoiceRecorder) => void = () => {}
      const staleCancel = vi.fn().mockResolvedValue(undefined)
      const activeCancel = vi.fn().mockResolvedValue(undefined)
      vi.mocked(startVoiceRecorder)
        .mockReturnValueOnce(new Promise((resolve) => {
          resolveFirstRecorder = resolve
        }))
        .mockReturnValueOnce(new Promise((resolve) => {
          resolveSecondRecorder = resolve
        }))

      render(
        <StrictMode>
          <VoiceInput
            onCancel={vi.fn()}
            onConverted={vi.fn()}
            target={target}
          />
        </StrictMode>,
      )
      resolveSecondRecorder({ ...recorder, cancel: activeCancel })
      expect(await screen.findByText('common.voiceInput.speaking')).toBeInTheDocument()

      resolveFirstRecorder({ ...recorder, cancel: staleCancel })

      await waitFor(() => expect(staleCancel).toHaveBeenCalledTimes(1))
      expect(activeCancel).not.toHaveBeenCalled()
    })
  })

  // Stopping must upload a real MP3 file to the explicit owner-provided target.
  describe('Conversion', () => {
    it('should upload MP3 bytes to the explicit app target', async () => {
      const { props } = renderVoiceInput()
      fireEvent.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))

      expect(await screen.findByRole('status')).toHaveTextContent('common.voiceInput.converting')
      await waitFor(() => expect(transcribeAudio).toHaveBeenCalledTimes(1))
      const [requestTarget, file] = vi.mocked(transcribeAudio).mock.calls[0]!
      expect(requestTarget).toBe(target)
      expect(file.name).toBe('temp.mp3')
      expect(file.type).toBe('audio/mp3')
      expect(props.onBeforeTranscribe).toHaveBeenCalledTimes(1)
      expect(vi.mocked(props.onBeforeTranscribe!).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(transcribeAudio).mock.invocationCallOrder[0]!,
      )
      await waitFor(() => expect(props.onConverted).toHaveBeenCalledWith('transcribed text'))
      expect(props.onCancel).toHaveBeenCalledTimes(1)
    })

    it('should ignore repeated stop requests', async () => {
      let resolveStop: (blob: Blob) => void = () => {}
      recorderStop.mockReturnValueOnce(new Promise((resolve) => {
        resolveStop = resolve
      }))
      renderVoiceInput()
      const stopButton = await screen.findByRole('button', { name: 'common.voiceInput.stop' })

      fireEvent.click(stopButton)
      fireEvent.click(stopButton)

      expect(recorderStop).toHaveBeenCalledTimes(1)
      resolveStop(new Blob(['mp3-data'], { type: 'audio/mp3' }))
      await waitFor(() => expect(transcribeAudio).toHaveBeenCalledTimes(1))
    })

    it('should report conversion failure without replacing the current text', async () => {
      vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error('API error'))
      const { props } = renderVoiceInput()
      fireEvent.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))

      await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(1))
      expect(props.onConverted).not.toHaveBeenCalled()
      expect(props.onCancel).toHaveBeenCalledTimes(1)
    })

    it('should not upload when saving the owning draft fails', async () => {
      const onBeforeTranscribe = vi.fn().mockRejectedValue(new Error('save failed'))
      const { props } = renderVoiceInput({ onBeforeTranscribe })
      fireEvent.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))

      await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(1))
      expect(transcribeAudio).not.toHaveBeenCalled()
      expect(props.onConverted).not.toHaveBeenCalled()
    })

    it('should close without publishing late results when conversion is cancelled', async () => {
      let requestSignal: AbortSignal | undefined
      vi.mocked(transcribeAudio).mockImplementationOnce((_target, _file, signal) => {
        requestSignal = signal
        return new Promise(() => {})
      })
      const { props } = renderVoiceInput()
      fireEvent.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))
      await waitFor(() => expect(transcribeAudio).toHaveBeenCalledTimes(1))
      fireEvent.click(await screen.findByRole('button', { name: 'common.operation.cancel' }))

      expect(recorderCancel).toHaveBeenCalledTimes(1)
      expect(requestSignal?.aborted).toBe(true)
      expect(props.onCancel).toHaveBeenCalledTimes(1)
      expect(props.onConverted).not.toHaveBeenCalled()
    })

    it('should not upload when conversion is cancelled while the recorder is stopping', async () => {
      let resolveStop: (blob: Blob) => void = () => {}
      recorderStop.mockReturnValueOnce(new Promise((resolve) => {
        resolveStop = resolve
      }))
      const { props } = renderVoiceInput()

      fireEvent.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))
      fireEvent.click(await screen.findByRole('button', { name: 'common.operation.cancel' }))
      resolveStop(new Blob(['mp3-data'], { type: 'audio/mp3' }))

      await act(async () => {})
      expect(transcribeAudio).not.toHaveBeenCalled()
      expect(props.onBeforeTranscribe).not.toHaveBeenCalled()
      expect(props.onCancel).toHaveBeenCalledTimes(1)
      expect(props.onError).not.toHaveBeenCalled()
    })

    it('should not upload when conversion is cancelled while the draft is saving', async () => {
      let resolveDraftSave: () => void = () => {}
      const onBeforeTranscribe = vi.fn(() => new Promise<void>((resolve) => {
        resolveDraftSave = resolve
      }))
      const { props } = renderVoiceInput({ onBeforeTranscribe })

      fireEvent.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))
      await waitFor(() => expect(onBeforeTranscribe).toHaveBeenCalledTimes(1))
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      resolveDraftSave()

      await act(async () => {})
      expect(transcribeAudio).not.toHaveBeenCalled()
      expect(props.onCancel).toHaveBeenCalledTimes(1)
      expect(props.onError).not.toHaveBeenCalled()
    })
  })

  // The ten-minute limit is a local timer transition, not a render-time side effect.
  describe('Duration limit', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.runOnlyPendingTimers()
      vi.useRealTimers()
    })

    it('should update the timer while recording', async () => {
      renderVoiceInput()
      await act(async () => {})

      act(() => vi.advanceTimersByTime(1000))

      expect(screen.getByTestId('voice-input-timer')).toHaveTextContent('00:01')
    })

    it('should stop automatically at ten minutes', async () => {
      renderVoiceInput()
      await act(async () => {})

      act(() => vi.advanceTimersByTime(600_000))
      await act(async () => {})

      expect(recorderStop).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('voice-input-timer')).toHaveTextContent('10:00')
    })
  })
})
