import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { audioToText } from '@/service/share'
import VoiceInput from './index'

const { mockState, MockRecorder } = vi.hoisted(() => {
  const state = {
    params: {} as Record<string, string>,
    pathname: '/test',
    recorderInstances: [] as unknown[],
    startOverride: null as (() => Promise<void>) | null,
    analyseData: new Uint8Array(1024).fill(150) as Uint8Array,
  }

  class MockRecorderClass {
    start = vi.fn((..._args: unknown[]) => {
      if (state.startOverride)
        return state.startOverride()
      return Promise.resolve()
    })

    stop = vi.fn()
    getRecordAnalyseData = vi.fn(() => state.analyseData)
    getWAV = vi.fn(() => new ArrayBuffer(0))
    getChannelData = vi.fn(() => ({
      left: { buffer: new ArrayBuffer(2048), byteLength: 2048 },
      right: { buffer: new ArrayBuffer(2048), byteLength: 2048 },
    }))

    constructor() {
      state.recorderInstances.push(this)
    }
  }

  return { mockState: state, MockRecorder: MockRecorderClass }
})

vi.mock('js-audio-recorder', () => ({
  default: MockRecorder,
}))

vi.mock('@/service/share', () => ({
  AppSourceType: { webApp: 'webApp', installedApp: 'installedApp' },
  audioToText: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => mockState.params),
  usePathname: vi.fn(() => mockState.pathname),
}))

vi.mock('./utils', () => ({
  convertToMp3: vi.fn(() => new Blob(['test'], { type: 'audio/mp3' })),
}))

describe('VoiceInput', () => {
  const onConverted = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockState.params = {}
    mockState.pathname = '/test'
    mockState.recorderInstances = []
    mockState.startOverride = null

    // Ensure canvas has non-zero dimensions for initCanvas()
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 300,
      height: 32,
      top: 0,
      left: 0,
      right: 300,
      bottom: 32,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    }))

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { })
  })

  it('should start recording on mount and show speaking state', async () => {
    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    // eslint-disable-next-line ts/no-explicit-any
    const recorder = mockState.recorderInstances[0] as any
    expect(recorder.start).toHaveBeenCalled()
    expect(await screen.findByText('common.voiceInput.speaking')).toBeInTheDocument()
    expect(screen.getByTestId('voice-input-stop')).toBeInTheDocument()
    expect(screen.getByTestId('voice-input-timer')).toHaveTextContent('00:00')
  })

  it('should call onCancel when recording start fails', async () => {
    mockState.startOverride = () => Promise.reject(new Error('Permission denied'))

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    await waitFor(() => {
      expect(onCancel).toHaveBeenCalled()
    })
  })

  it('should stop recording and convert audio on stop click', async () => {
    const user = userEvent.setup()
    vi.mocked(audioToText).mockResolvedValueOnce({ text: 'hello world' })
    mockState.params = { token: 'abc' }

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    const stopBtn = await screen.findByTestId('voice-input-stop')
    await user.click(stopBtn)

    // eslint-disable-next-line ts/no-explicit-any
    const recorder = mockState.recorderInstances[0] as any
    expect(await screen.findByTestId('voice-input-converting-text')).toBeInTheDocument()
    expect(screen.getByText('common.voiceInput.converting')).toBeInTheDocument()
    expect(screen.getByTestId('voice-input-loader')).toBeInTheDocument()

    await waitFor(() => {
      expect(recorder.stop).toHaveBeenCalled()
      expect(onConverted).toHaveBeenCalledWith('hello world')
      expect(onCancel).toHaveBeenCalled()
    })
  })

  it('should call onConverted with empty string on conversion failure', async () => {
    const user = userEvent.setup()
    vi.mocked(audioToText).mockRejectedValueOnce(new Error('API error'))
    mockState.params = { token: 'abc' }

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    const stopBtn = await screen.findByTestId('voice-input-stop')
    await user.click(stopBtn)

    await waitFor(() => {
      expect(onConverted).toHaveBeenCalledWith('')
      expect(onCancel).toHaveBeenCalled()
    })
  })

  it('should show cancel button during conversion and cancel on click', async () => {
    const user = userEvent.setup()
    vi.mocked(audioToText).mockImplementation(() => new Promise(() => { }))
    mockState.params = { token: 'abc' }

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    const stopBtn = await screen.findByTestId('voice-input-stop')
    await user.click(stopBtn)

    const cancelBtn = await screen.findByTestId('voice-input-cancel')
    await user.click(cancelBtn)

    expect(onCancel).toHaveBeenCalled()
  })

  it('should draw on canvas with low data values triggering v < 128 clamp', async () => {
    mockState.analyseData = new Uint8Array(1024).fill(50)

    let rafCalls = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCalls++
      if (rafCalls <= 2)
        cb(0)
      return rafCalls
    })

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    await screen.findByTestId('voice-input-stop')

    // eslint-disable-next-line ts/no-explicit-any
    const firstRecorder = mockState.recorderInstances[0] as any
    expect(firstRecorder.getRecordAnalyseData).toHaveBeenCalled()
  })

  it('should draw on canvas with high data values triggering v > 178 clamp', async () => {
    mockState.analyseData = new Uint8Array(1024).fill(250)

    let rafCalls = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCalls++
      if (rafCalls <= 2)
        cb(0)
      return rafCalls
    })

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    await screen.findByTestId('voice-input-stop')

    // eslint-disable-next-line ts/no-explicit-any
    const firstRecorder = mockState.recorderInstances[0] as any
    expect(firstRecorder.getRecordAnalyseData).toHaveBeenCalled()
  })

  it('should pass wordTimestamps in form data', async () => {
    const user = userEvent.setup()
    vi.mocked(audioToText).mockResolvedValueOnce({ text: 'test' })
    mockState.params = { token: 'abc' }

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} wordTimestamps="enabled" />)
    const stopBtn = await screen.findByTestId('voice-input-stop')
    await user.click(stopBtn)

    await waitFor(() => {
      expect(audioToText).toHaveBeenCalled()
      const formData = vi.mocked(audioToText).mock.calls[0][2] as FormData
      expect(formData.get('word_timestamps')).toBe('enabled')
    })
  })

  describe('URL patterns', () => {
    it('should use webApp source with /audio-to-text for token-based URL', async () => {
      const user = userEvent.setup()
      vi.mocked(audioToText).mockResolvedValueOnce({ text: 'test' })
      mockState.params = { token: 'my-token' }

      render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
      await user.click(await screen.findByTestId('voice-input-stop'))

      await waitFor(() => {
        expect(audioToText).toHaveBeenCalledWith('/audio-to-text', 'webApp', expect.any(FormData))
      })
    })

    it('should use installed-apps URL when pathname includes explore/installed', async () => {
      const user = userEvent.setup()
      vi.mocked(audioToText).mockResolvedValueOnce({ text: 'test' })
      mockState.params = { appId: 'app-123' }
      mockState.pathname = '/explore/installed'

      render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
      await user.click(await screen.findByTestId('voice-input-stop'))

      await waitFor(() => {
        expect(audioToText).toHaveBeenCalledWith(
          '/installed-apps/app-123/audio-to-text',
          'installedApp',
          expect.any(FormData),
        )
      })
    })

    it('should use /apps URL for non-explore paths with appId', async () => {
      const user = userEvent.setup()
      vi.mocked(audioToText).mockResolvedValueOnce({ text: 'test' })
      mockState.params = { appId: 'app-456' }
      mockState.pathname = '/dashboard/apps'

      render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
      await user.click(await screen.findByTestId('voice-input-stop'))

      await waitFor(() => {
        expect(audioToText).toHaveBeenCalledWith(
          '/apps/app-456/audio-to-text',
          'installedApp',
          expect.any(FormData),
        )
      })
    })
  })
})
