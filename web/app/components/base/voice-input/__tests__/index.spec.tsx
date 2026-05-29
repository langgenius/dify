import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { audioToText } from '@/service/share'
import VoiceInput from '../index'

const { mockState, MockRecorder, rafState } = vi.hoisted(() => {
  const state = {
    params: {} as Record<string, string>,
    pathname: '/test',
    recorderInstances: [] as unknown[],
    startOverride: null as (() => Promise<void>) | null,
    analyseData: new Uint8Array(1024).fill(150) as Uint8Array,
  }
  const rafStateObj = {
    callback: null as (() => void) | null,
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

  return { mockState: state, MockRecorder: MockRecorderClass, rafState: rafStateObj }
})

vi.mock('js-audio-recorder', () => ({
  default: MockRecorder,
}))

vi.mock('@/service/share', () => ({
  AppSourceType: { webApp: 'webApp', installedApp: 'installedApp' },
  audioToText: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useParams: vi.fn(() => mockState.params),
  usePathname: vi.fn(() => mockState.pathname),
}))

vi.mock('../utils', () => ({
  convertToMp3: vi.fn(() => new Blob(['test'], { type: 'audio/mp3' })),
}))

vi.mock('ahooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ahooks')>()
  return {
    ...actual,
    useRafInterval: vi.fn((fn) => {
      rafState.callback = fn
      return vi.fn()
    }),
  }
})

describe('VoiceInput', () => {
  const onConverted = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockState.params = {}
    mockState.pathname = '/test'
    mockState.recorderInstances = []
    mockState.startOverride = null
    rafState.callback = null

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
    expect(await screen.findByText('common.voiceInput.speaking'))!.toBeInTheDocument()
    expect(screen.getByTestId('voice-input-stop'))!.toBeInTheDocument()
    expect(screen.getByTestId('voice-input-timer'))!.toHaveTextContent('00:00')
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
    expect(await screen.findByTestId('voice-input-converting-text'))!.toBeInTheDocument()
    expect(screen.getByText('common.voiceInput.converting'))!.toBeInTheDocument()
    expect(screen.getByTestId('voice-input-loader'))!.toBeInTheDocument()

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
      const formData = vi.mocked(audioToText).mock.calls[0]![2] as FormData
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

  it('should use fallback rect when canvas roundRect is not available', async () => {
    const user = userEvent.setup()
    vi.mocked(audioToText).mockResolvedValueOnce({ text: 'test' })
    mockState.params = { token: 'abc' }
    mockState.analyseData = new Uint8Array(1024).fill(150)

    const oldGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      scale: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
      closePath: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext

    let rafCalls = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCalls++
      if (rafCalls <= 1)
        cb(0)
      return rafCalls
    })

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    await user.click(await screen.findByTestId('voice-input-stop'))

    await waitFor(() => {
      expect(onConverted).toHaveBeenCalled()
    })
    HTMLCanvasElement.prototype.getContext = oldGetContext
  })

  it('should display timer in MM:SS format correctly', async () => {
    mockState.params = { token: 'abc' }

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    const timer = await screen.findByTestId('voice-input-timer')
    expect(timer)!.toHaveTextContent('00:00')

    await act(async () => {
      if (rafState.callback)
        rafState.callback()
    })
    expect(timer)!.toHaveTextContent('00:01')

    for (let i = 0; i < 9; i++) {
      await act(async () => {
        if (rafState.callback)
          rafState.callback()
      })
    }
    expect(timer)!.toHaveTextContent('00:10')
  })

  it('should show timer element with formatted time', async () => {
    mockState.params = { token: 'abc' }

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    const timer = screen.getByTestId('voice-input-timer')
    expect(timer)!.toBeInTheDocument()
    // Initial state should show 00:00
    expect(timer.textContent).toMatch(/0\d:\d{2}/)
  })

  it('should handle data values in normal range (between 128 and 178)', async () => {
    mockState.analyseData = new Uint8Array(1024).fill(150)

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
    const recorder = mockState.recorderInstances[0] as any
    expect(recorder.getRecordAnalyseData).toHaveBeenCalled()
  })

  it('should handle canvas context and device pixel ratio', async () => {
    const dprSpy = vi.spyOn(window, 'devicePixelRatio', 'get')
    dprSpy.mockReturnValue(2)

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    await screen.findByTestId('voice-input-stop')

    expect(screen.getByTestId('voice-input-stop'))!.toBeInTheDocument()

    dprSpy.mockRestore()
  })

  it('should handle empty params with no token or appId', async () => {
    const user = userEvent.setup()
    vi.mocked(audioToText).mockResolvedValueOnce({ text: 'test' })
    mockState.params = {}
    mockState.pathname = '/test'

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    const stopBtn = await screen.findByTestId('voice-input-stop')
    await user.click(stopBtn)

    await waitFor(() => {
      // Should call audioToText with empty URL when neither token nor appId is present
      expect(audioToText).toHaveBeenCalledWith('', 'installedApp', expect.any(FormData))
    })
  })

  it('should render speaking state indicator', async () => {
    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    expect(await screen.findByText('common.voiceInput.speaking'))!.toBeInTheDocument()
  })

  it('should cleanup on unmount', () => {
    const { unmount } = render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    // eslint-disable-next-line ts/no-explicit-any
    const recorder = mockState.recorderInstances[0] as any

    unmount()

    expect(recorder.stop).toHaveBeenCalled()
  })

  it('should handle all data in recordAnalyseData for canvas drawing', async () => {
    const allDataValues = []
    for (let i = 0; i < 256; i++) {
      allDataValues.push(i)
    }
    mockState.analyseData = new Uint8Array(allDataValues)

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
    const recorder = mockState.recorderInstances[0] as any
    expect(recorder.getRecordAnalyseData).toHaveBeenCalled()
  })

  it('should pass multiple props correctly', async () => {
    const user = userEvent.setup()
    vi.mocked(audioToText).mockResolvedValueOnce({ text: 'test' })
    mockState.params = { token: 'token123' }

    render(
      <VoiceInput
        onConverted={onConverted}
        onCancel={onCancel}
        wordTimestamps="enabled"
      />,
    )

    const stopBtn = await screen.findByTestId('voice-input-stop')
    await user.click(stopBtn)

    await waitFor(() => {
      const calls = vi.mocked(audioToText).mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const [url, sourceType, formData] = (calls[0] ?? []) as [any, any, any]
      expect(url).toBe('/audio-to-text')
      expect(sourceType).toBe('webApp')
      expect(formData.get('word_timestamps')).toBe('enabled')
    })
  })

  it('should handle pathname with explore/installed correctly when appId exists', async () => {
    const user = userEvent.setup()
    vi.mocked(audioToText).mockResolvedValueOnce({ text: 'test' })
    mockState.params = { appId: 'app-id-123' }
    mockState.pathname = '/explore/installed/app-details'

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    const stopBtn = await screen.findByTestId('voice-input-stop')
    await user.click(stopBtn)

    await waitFor(() => {
      expect(audioToText).toHaveBeenCalledWith(
        '/installed-apps/app-id-123/audio-to-text',
        'installedApp',
        expect.any(FormData),
      )
    })
  })

  it('should render timer with initial 00:00 value', () => {
    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    const timer = screen.getByTestId('voice-input-timer')
    expect(timer)!.toHaveTextContent('00:00')
  })

  it('should render stop button during recording', async () => {
    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    expect(await screen.findByTestId('voice-input-stop'))!.toBeInTheDocument()
  })

  it('should render converting UI after stopping', async () => {
    const user = userEvent.setup()
    vi.mocked(audioToText).mockImplementation(() => new Promise(() => { }))
    mockState.params = { token: 'abc' }

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    const stopBtn = await screen.findByTestId('voice-input-stop')
    await user.click(stopBtn)

    await screen.findByTestId('voice-input-loader')
    expect(screen.getByTestId('voice-input-converting-text'))!.toBeInTheDocument()
    expect(screen.getByTestId('voice-input-cancel'))!.toBeInTheDocument()
  })

  it('should auto-stop recording and convert audio when duration reaches 10 minutes (600s)', async () => {
    vi.mocked(audioToText).mockResolvedValueOnce({ text: 'auto-stopped text' })
    mockState.params = { token: 'abc' }

    render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    expect(await screen.findByTestId('voice-input-stop'))!.toBeInTheDocument()

    for (let i = 0; i < 601; i++) {
      await act(async () => {
        if (rafState.callback)
          rafState.callback()
      })
    }

    expect(await screen.findByTestId('voice-input-converting-text'))!.toBeInTheDocument()
    await waitFor(() => {
      expect(onConverted).toHaveBeenCalledWith('auto-stopped text')
    })
  }, 10000)

  it('should handle null canvas element gracefully during initialization', async () => {
    const getElementByIdMock = vi.spyOn(document, 'getElementById').mockReturnValue(null)

    const { unmount } = render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    await screen.findByTestId('voice-input-stop')

    unmount()

    getElementByIdMock.mockRestore()
  })

  it('should handle getContext returning null gracefully during initialization', async () => {
    const oldGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null)

    const { unmount } = render(<VoiceInput onConverted={onConverted} onCancel={onCancel} />)
    await screen.findByTestId('voice-input-stop')

    unmount()

    HTMLCanvasElement.prototype.getContext = oldGetContext
  })
})
