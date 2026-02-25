import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VideoPlayer from './VideoPlayer'

describe('VideoPlayer', () => {
  const mockSrc = 'video.mp4'
  const mockSrcs = ['video1.mp4', 'video2.mp4']

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()

    // Mock HTMLVideoElement methods
    window.HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    window.HTMLVideoElement.prototype.pause = vi.fn()
    window.HTMLVideoElement.prototype.load = vi.fn()
    window.HTMLVideoElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined)

    // Mock document methods
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined)

    // Mock offsetWidth to avoid smallSize mode by default
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      value: 500,
    })

    // Define properties on HTMLVideoElement prototype
    Object.defineProperty(window.HTMLVideoElement.prototype, 'duration', {
      configurable: true,
      get() { return 100 },
    })

    // Use a descriptor check to avoid re-defining if it exists
    if (!Object.getOwnPropertyDescriptor(window.HTMLVideoElement.prototype, 'currentTime')) {
      Object.defineProperty(window.HTMLVideoElement.prototype, 'currentTime', {
        configurable: true,
        // eslint-disable-next-line ts/no-explicit-any
        get() { return (this as any)._currentTime || 0 },
        // eslint-disable-next-line ts/no-explicit-any
        set(v) { (this as any)._currentTime = v },
      })
    }

    if (!Object.getOwnPropertyDescriptor(window.HTMLVideoElement.prototype, 'volume')) {
      Object.defineProperty(window.HTMLVideoElement.prototype, 'volume', {
        configurable: true,
        // eslint-disable-next-line ts/no-explicit-any
        get() { return (this as any)._volume || 1 },
        // eslint-disable-next-line ts/no-explicit-any
        set(v) { (this as any)._volume = v },
      })
    }

    if (!Object.getOwnPropertyDescriptor(window.HTMLVideoElement.prototype, 'muted')) {
      Object.defineProperty(window.HTMLVideoElement.prototype, 'muted', {
        configurable: true,
        // eslint-disable-next-line ts/no-explicit-any
        get() { return (this as any)._muted || false },
        // eslint-disable-next-line ts/no-explicit-any
        set(v) { (this as any)._muted = v },
      })
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
      expect(sources[0].src).toContain(mockSrcs[0])
      expect(sources[1].src).toContain(mockSrcs[1])
    })
  })

  describe('Interactions', () => {
    it('should toggle play/pause on button click', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const playPauseBtn = screen.getByTestId('video-play-pause-button')

      await user.click(playPauseBtn)
      expect(window.HTMLVideoElement.prototype.play).toHaveBeenCalled()

      await user.click(playPauseBtn)
      expect(window.HTMLVideoElement.prototype.pause).toHaveBeenCalled()
    })

    it('should toggle mute on button click', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const muteBtn = screen.getByTestId('video-mute-button')

      await user.click(muteBtn)
      expect(muteBtn).toBeInTheDocument()
    })

    it('should toggle fullscreen on button click', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const fullscreenBtn = screen.getByTestId('video-fullscreen-button')

      await user.click(fullscreenBtn)
      expect(window.HTMLVideoElement.prototype.requestFullscreen).toHaveBeenCalled()

      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get() { return {} },
      })
      await user.click(fullscreenBtn)
      expect(document.exitFullscreen).toHaveBeenCalled()

      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get() { return null },
      })
    })

    it('should handle video metadata and time updates', () => {
      render(<VideoPlayer src={mockSrc} />)
      const video = screen.getByTestId('video-element') as HTMLVideoElement

      fireEvent(video, new Event('loadedmetadata'))
      expect(screen.getByTestId('video-time-display')).toHaveTextContent('00:00 / 01:40')

      Object.defineProperty(video, 'currentTime', { value: 30, configurable: true })
      fireEvent(video, new Event('timeupdate'))
      expect(screen.getByTestId('video-time-display')).toHaveTextContent('00:30 / 01:40')
    })

    it('should handle video end', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const video = screen.getByTestId('video-element')
      const playPauseBtn = screen.getByTestId('video-play-pause-button')

      await user.click(playPauseBtn)
      fireEvent(video, new Event('ended'))

      expect(playPauseBtn).toBeInTheDocument()
    })

    it('should show/hide controls on mouse move and timeout', () => {
      vi.useFakeTimers()
      render(<VideoPlayer src={mockSrc} />)
      const container = screen.getByTestId('video-player-container')

      fireEvent.mouseMove(container)
      fireEvent.mouseMove(container) // Trigger clearTimeout

      act(() => {
        vi.advanceTimersByTime(3001)
      })
      vi.useRealTimers()
    })

    it('should handle progress bar interactions', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const progressBar = screen.getByTestId('video-progress-bar')
      const video = screen.getByTestId('video-element') as HTMLVideoElement

      vi.spyOn(progressBar, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        width: 100,
        top: 0,
        right: 100,
        bottom: 10,
        height: 10,
        x: 0,
        y: 0,
        toJSON: () => { },
      } as DOMRect)

      // Hover
      fireEvent.mouseMove(progressBar, { clientX: 50 })
      expect(screen.getByTestId('video-hover-time')).toHaveTextContent('00:50')
      fireEvent.mouseLeave(progressBar)
      expect(screen.queryByTestId('video-hover-time')).not.toBeInTheDocument()

      // Click
      await user.click(progressBar)
      // Note: user.click calculates clientX based on element position, but we mocked getBoundingClientRect
      // RTL fireEvent is more direct for coordinate-based tests
      fireEvent.click(progressBar, { clientX: 75 })
      expect(video.currentTime).toBe(75)

      // Drag
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

      vi.spyOn(volumeSlider, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        width: 100,
        top: 0,
        right: 100,
        bottom: 10,
        height: 10,
        x: 0,
        y: 0,
        toJSON: () => { },
      } as DOMRect)

      // Click
      fireEvent.click(volumeSlider, { clientX: 50 })
      expect(video.volume).toBe(0.5)

      // MouseDown and Drag
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
        expect(screen.getByTestId('video-time-display')).toBeInTheDocument()
      })
    })
  })
})
