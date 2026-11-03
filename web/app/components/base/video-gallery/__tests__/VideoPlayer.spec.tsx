import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import VideoPlayer from '../VideoPlayer'

describe('VideoPlayer', () => {
  const mockSrc = 'video.mp4'
  const mockSrcs = ['video1.mp4', 'video2.mp4']

  const mockBoundingRect = (element: Element) => {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
      top: 0,
      right: 100,
      bottom: 10,
      height: 10,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect)
  }

  const getPlayButton = () => screen.getByRole('button', { name: 'common.operation.play' })
  const getPauseButton = () => screen.getByRole('button', { name: 'common.operation.pause' })
  const getMuteButton = () => screen.getByRole('button', { name: 'common.operation.toggleMute' })
  const getFullscreenButton = () =>
    screen.getByRole('button', { name: 'common.operation.toggleFullscreen' })

  const originalFullscreen = Object.getOwnPropertyDescriptor(
    HTMLVideoElement.prototype,
    'requestFullscreen',
  )
  const originalExitFullscreen = Object.getOwnPropertyDescriptor(document, 'exitFullscreen')
  const originalFullscreenElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    Object.defineProperty(HTMLVideoElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500)
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(100)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    for (const [target, key, descriptor] of [
      [HTMLVideoElement.prototype, 'requestFullscreen', originalFullscreen],
      [document, 'exitFullscreen', originalExitFullscreen],
      [document, 'fullscreenElement', originalFullscreenElement],
    ] as const) {
      if (descriptor) Object.defineProperty(target, key, descriptor)
      else Reflect.deleteProperty(target, key)
    }
  })

  describe('Rendering', () => {
    it('should render with single src', () => {
      render(<VideoPlayer src={mockSrc} />)
      const video = screen.getByTestId('video-element') as HTMLVideoElement
      expect(video.src).toContain(mockSrc)
    })

    it('should render with multiple srcs', () => {
      render(<VideoPlayer srcs={mockSrcs} />)
      const sources = screen.getByTestId('video-element').querySelectorAll('source')
      expect(sources).toHaveLength(2)
      expect(sources[0]!.src).toContain(mockSrcs[0])
      expect(sources[1]!.src).toContain(mockSrcs[1])
    })
  })

  describe('Interactions', () => {
    it('should toggle play/pause on button click', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const playPauseBtn = getPlayButton()

      await user.click(playPauseBtn)
      expect(window.HTMLVideoElement.prototype.play).toHaveBeenCalled()

      await user.click(getPauseButton())
      expect(window.HTMLVideoElement.prototype.pause).toHaveBeenCalled()
    })

    it('should toggle mute on button click', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const video = screen.getByTestId('video-element') as HTMLVideoElement
      const muteBtn = getMuteButton()

      video.volume = 0.7

      await user.click(muteBtn)
      expect(video.muted).toBe(true)

      expect(video.volume).toBe(0.7)

      await user.click(muteBtn)
      expect(video.muted).toBe(false)
      expect(video.volume).toBe(0.7)
    })

    it('should toggle fullscreen on button click', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const fullscreenBtn = getFullscreenButton()

      await user.click(fullscreenBtn)
      expect(window.HTMLVideoElement.prototype.requestFullscreen).toHaveBeenCalled()

      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get() {
          return {}
        },
      })
      await user.click(fullscreenBtn)
      expect(document.exitFullscreen).toHaveBeenCalled()

      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get() {
          return null
        },
      })
    })

    it('should handle video metadata and time updates', () => {
      render(<VideoPlayer src={mockSrc} />)
      const video = screen.getByTestId('video-element') as HTMLVideoElement

      fireEvent(video, new Event('loadedmetadata'))
      expect(screen.getByTestId('video-time-display'))!.toHaveTextContent('00:00 / 01:40')

      Object.defineProperty(video, 'currentTime', { value: 30, configurable: true })
      fireEvent(video, new Event('timeupdate'))
      expect(screen.getByTestId('video-time-display'))!.toHaveTextContent('00:30 / 01:40')
    })

    it('should handle video end', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const video = screen.getByTestId('video-element')
      const playPauseBtn = getPlayButton()

      await user.click(playPauseBtn)
      fireEvent(video, new Event('ended'))

      expect(getPlayButton())!.toBeInTheDocument()
    })

    it('should handle progress bar interactions', () => {
      render(<VideoPlayer src={mockSrc} />)
      const progressBar = screen.getByTestId('video-progress-bar')
      const video = screen.getByTestId('video-element') as HTMLVideoElement

      mockBoundingRect(progressBar)

      fireEvent.mouseMove(progressBar, { clientX: 50 })
      expect(screen.getByTestId('video-hover-time'))!.toHaveTextContent('00:50')
      fireEvent.mouseLeave(progressBar)
      expect(screen.queryByTestId('video-hover-time')).not.toBeInTheDocument()

      fireEvent.click(progressBar, { clientX: 75 })
      expect(video.currentTime).toBe(75)

      fireEvent.mouseDown(progressBar, { clientX: 20 })
      expect(video.currentTime).toBe(20)
      fireEvent.mouseMove(document, { clientX: 40 })
      expect(video.currentTime).toBe(40)
      fireEvent.mouseUp(document)
      fireEvent.mouseMove(document, { clientX: 60 })
      expect(video.currentTime).toBe(40)
    })

    it('should handle volume slider change', () => {
      render(<VideoPlayer src={mockSrc} />)
      const volumeSlider = screen.getByTestId('video-volume-slider')
      const video = screen.getByTestId('video-element') as HTMLVideoElement

      mockBoundingRect(volumeSlider)

      fireEvent.click(volumeSlider, { clientX: 50 })
      expect(video.volume).toBe(0.5)

      fireEvent.mouseDown(volumeSlider, { clientX: 80 })
      expect(video.volume).toBe(0.8)

      fireEvent.mouseMove(document, { clientX: 90 })
      expect(video.volume).toBe(0.9)

      fireEvent.mouseUp(document) // Trigger cleanup
      fireEvent.mouseMove(document, { clientX: 100 })
      expect(video.volume).toBe(0.9) // No change after mouseUp
    })

    it('should handle small size class based on offsetWidth', async () => {
      render(<VideoPlayer src={mockSrc} />)
      const playerContainer = screen.getByTestId('video-player-container')

      Object.defineProperty(playerContainer, 'offsetWidth', { value: 300, configurable: true })

      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      await waitFor(() => {
        expect(screen.queryByTestId('video-time-display')).not.toBeInTheDocument()
      })

      Object.defineProperty(playerContainer, 'offsetWidth', { value: 500, configurable: true })
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('video-time-display'))!.toBeInTheDocument()
      })
    })

    it('should handle play() rejection error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('Play failed'))
      const user = userEvent.setup()

      try {
        render(<VideoPlayer src={mockSrc} />)
        const playPauseBtn = getPlayButton()

        await user.click(playPauseBtn)

        await waitFor(() => {
          expect(getPlayButton()).toBeInTheDocument()
          expect(
            screen.queryByRole('button', { name: 'common.operation.pause' }),
          ).not.toBeInTheDocument()
        })
      } finally {
        consoleSpy.mockRestore()
      }
    })

    it('should reset volume to 1 when unmuting with volume at 0', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const video = screen.getByTestId('video-element') as HTMLVideoElement
      const muteBtn = getMuteButton()

      await user.click(muteBtn)
      expect(video.muted).toBe(true)
      expect(video.volume).toBe(1)

      video.volume = 0

      await user.click(muteBtn)
      expect(video.muted).toBe(false)
      expect(video.volume).toBe(1)
    })

    it('should not clear hoverTime on mouseLeave while dragging', () => {
      render(<VideoPlayer src={mockSrc} />)
      const progressBar = screen.getByTestId('video-progress-bar')

      mockBoundingRect(progressBar)

      fireEvent.mouseDown(progressBar, { clientX: 50 })

      fireEvent.mouseLeave(progressBar)
      expect(screen.getByTestId('video-hover-time'))!.toBeInTheDocument()

      fireEvent.mouseUp(document)
    })

    it('should not update time for out-of-bounds progress click', () => {
      render(<VideoPlayer src={mockSrc} />)
      const progressBar = screen.getByTestId('video-progress-bar')
      const video = screen.getByTestId('video-element') as HTMLVideoElement

      mockBoundingRect(progressBar)

      fireEvent.click(progressBar, { clientX: 200 })
      expect(video.currentTime).toBe(0)

      fireEvent.click(progressBar, { clientX: -50 })
      expect(video.currentTime).toBe(0)
    })

    it('should show controls on mouseEnter', () => {
      vi.useFakeTimers()
      render(<VideoPlayer src={mockSrc} />)
      const container = screen.getByTestId('video-player-container')
      const controls = screen.getByTestId('video-controls')

      expect(controls)!.toHaveAttribute('data-is-visible', 'true')

      fireEvent.mouseMove(container)
      act(() => {
        vi.advanceTimersByTime(3001)
      })
      expect(controls)!.toHaveAttribute('data-is-visible', 'false')

      fireEvent.mouseEnter(container)
      expect(controls)!.toHaveAttribute('data-is-visible', 'true')

      vi.useRealTimers()
    })

    it('unmutes playback when the volume slider is raised', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const video = screen.getByTestId('video-element') as HTMLVideoElement
      const slider = screen.getByTestId('video-volume-slider')
      mockBoundingRect(slider)
      await user.click(getMuteButton())
      expect(video.muted).toBe(true)
      fireEvent.click(slider, { clientX: 40 })
      expect(video.muted).toBe(false)
      expect(video.volume).toBe(0.4)
      expect(getMuteButton()).toHaveAttribute('aria-pressed', 'false')
    })

    it('removes volume drag listeners if the player unmounts before mouseup', () => {
      const addListener = vi.spyOn(document, 'addEventListener')
      const removeListener = vi.spyOn(document, 'removeEventListener')
      const { unmount } = render(<VideoPlayer src={mockSrc} />)
      const slider = screen.getByTestId('video-volume-slider')
      mockBoundingRect(slider)
      fireEvent.mouseDown(slider, { clientX: 50 })
      const move = [...addListener.mock.calls]
        .reverse()
        .find(([event]) => event === 'mousemove')![1]
      const up = [...addListener.mock.calls].reverse().find(([event]) => event === 'mouseup')![1]

      unmount()

      expect(removeListener).toHaveBeenCalledWith('mousemove', move)
      expect(removeListener).toHaveBeenCalledWith('mouseup', up)
    })

    it('should clamp volume slider to max 1', () => {
      render(<VideoPlayer src={mockSrc} />)
      const volumeSlider = screen.getByTestId('video-volume-slider')
      const video = screen.getByTestId('video-element') as HTMLVideoElement

      mockBoundingRect(volumeSlider)

      fireEvent.click(volumeSlider, { clientX: 200 })
      expect(video.volume).toBe(1)
    })
  })
})
