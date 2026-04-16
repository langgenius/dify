import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
      toJSON: () => { },
    } as DOMRect)
  }

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

    type MockVideoElement = HTMLVideoElement & {
      _currentTime?: number
      _volume?: number
      _muted?: boolean
    }

    // Use a descriptor check to avoid re-defining if it exists
    if (!Object.getOwnPropertyDescriptor(window.HTMLVideoElement.prototype, 'currentTime')) {
      Object.defineProperty(window.HTMLVideoElement.prototype, 'currentTime', {
        configurable: true,
        get() { return (this as MockVideoElement)._currentTime || 0 },
        set(v) { (this as MockVideoElement)._currentTime = v },
      })
    }

    if (!Object.getOwnPropertyDescriptor(window.HTMLVideoElement.prototype, 'volume')) {
      Object.defineProperty(window.HTMLVideoElement.prototype, 'volume', {
        configurable: true,
        get() { return (this as MockVideoElement)._volume ?? 1 },
        set(v) { (this as MockVideoElement)._volume = v },
      })
    }

    if (!Object.getOwnPropertyDescriptor(window.HTMLVideoElement.prototype, 'muted')) {
      Object.defineProperty(window.HTMLVideoElement.prototype, 'muted', {
        configurable: true,
        get() { return (this as MockVideoElement)._muted || false },
        set(v) { (this as MockVideoElement)._muted = v },
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
      expect(sources[0]!.src).toContain(mockSrcs[0])
      expect(sources[1]!.src).toContain(mockSrcs[1])
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
      const video = screen.getByTestId('video-element') as HTMLVideoElement
      const muteBtn = screen.getByTestId('video-mute-button')

      // Ensure volume is positive before muting
      video.volume = 0.7

      // First click mutes
      await user.click(muteBtn)
      expect(video.muted).toBe(true)

      // Set volume back to a positive value to test the volume > 0 branch in unmute
      video.volume = 0.7

      // Second click unmutes — since volume > 0, the ternary should keep video.volume
      await user.click(muteBtn)
      expect(video.muted).toBe(false)
      expect(video.volume).toBe(0.7)
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
      expect(screen.getByTestId('video-time-display'))!.toHaveTextContent('00:00 / 01:40')

      Object.defineProperty(video, 'currentTime', { value: 30, configurable: true })
      fireEvent(video, new Event('timeupdate'))
      expect(screen.getByTestId('video-time-display'))!.toHaveTextContent('00:30 / 01:40')
    })

    it('should handle video end', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const video = screen.getByTestId('video-element')
      const playPauseBtn = screen.getByTestId('video-play-pause-button')

      await user.click(playPauseBtn)
      fireEvent(video, new Event('ended'))

      expect(playPauseBtn)!.toBeInTheDocument()
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

      mockBoundingRect(progressBar)

      // Hover
      fireEvent.mouseMove(progressBar, { clientX: 50 })
      expect(screen.getByTestId('video-hover-time'))!.toHaveTextContent('00:50')
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

      mockBoundingRect(volumeSlider)

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
        expect(screen.getByTestId('video-time-display'))!.toBeInTheDocument()
      })
    })

    it('should handle play() rejection error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
      window.HTMLVideoElement.prototype.play = vi.fn().mockRejectedValue(new Error('Play failed'))
      const user = userEvent.setup()

      try {
        render(<VideoPlayer src={mockSrc} />)
        const playPauseBtn = screen.getByTestId('video-play-pause-button')

        await user.click(playPauseBtn)

        await waitFor(() => {
          expect(consoleSpy).toHaveBeenCalledWith('Error playing video:', expect.any(Error))
        })
      }
      finally {
        consoleSpy.mockRestore()
      }
    })

    it('should reset volume to 1 when unmuting with volume at 0', async () => {
      const user = userEvent.setup()
      render(<VideoPlayer src={mockSrc} />)
      const video = screen.getByTestId('video-element') as HTMLVideoElement
      const muteBtn = screen.getByTestId('video-mute-button')

      // First click mutes — this sets volume to 0 and muted to true
      await user.click(muteBtn)
      expect(video.muted).toBe(true)
      expect(video.volume).toBe(0)

      // Now explicitly ensure video.volume is 0 for unmute path
      video.volume = 0

      // Second click unmutes — since volume is 0, the ternary
      // (video.volume > 0 ? video.volume : 1) should choose 1
      await user.click(muteBtn)
      expect(video.muted).toBe(false)
      expect(video.volume).toBe(1)
    })

    it('should not clear hoverTime on mouseLeave while dragging', () => {
      render(<VideoPlayer src={mockSrc} />)
      const progressBar = screen.getByTestId('video-progress-bar')

      mockBoundingRect(progressBar)

      // Start dragging
      fireEvent.mouseDown(progressBar, { clientX: 50 })

      // mouseLeave while dragging — hoverTime should remain visible
      fireEvent.mouseLeave(progressBar)
      expect(screen.getByTestId('video-hover-time'))!.toBeInTheDocument()

      // End drag
      fireEvent.mouseUp(document)
    })

    it('should not update time for out-of-bounds progress click', () => {
      render(<VideoPlayer src={mockSrc} />)
      const progressBar = screen.getByTestId('video-progress-bar')
      const video = screen.getByTestId('video-element') as HTMLVideoElement

      mockBoundingRect(progressBar)

      // Click far beyond the bar (clientX > rect.width) — pos > 1, newTime > duration
      fireEvent.click(progressBar, { clientX: 200 })
      // currentTime should remain unchanged since newTime (200) > duration (100)
      expect(video.currentTime).toBe(0)

      // Click at negative position
      fireEvent.click(progressBar, { clientX: -50 })
      // currentTime should remain unchanged since newTime < 0
      expect(video.currentTime).toBe(0)
    })

    it('should render without src or srcs', () => {
      render(<VideoPlayer />)
      const video = screen.getByTestId('video-element') as HTMLVideoElement
      expect(video)!.toBeInTheDocument()
      expect(video.getAttribute('src')).toBeNull()
      expect(video.querySelectorAll('source')).toHaveLength(0)
    })

    it('should show controls on mouseEnter', () => {
      vi.useFakeTimers()
      render(<VideoPlayer src={mockSrc} />)
      const container = screen.getByTestId('video-player-container')
      const controls = screen.getByTestId('video-controls')

      // Initial state: visible
      // Initial state: visible
      expect(controls)!.toHaveAttribute('data-is-visible', 'true')

      // Let controls hide
      fireEvent.mouseMove(container)
      act(() => {
        vi.advanceTimersByTime(3001)
      })
      expect(controls)!.toHaveAttribute('data-is-visible', 'false')

      // mouseEnter should show controls again
      fireEvent.mouseEnter(container)
      expect(controls)!.toHaveAttribute('data-is-visible', 'true')

      vi.useRealTimers()
    })

    it('should handle volume drag with inline mouseDown handler', () => {
      render(<VideoPlayer src={mockSrc} />)
      const volumeSlider = screen.getByTestId('video-volume-slider')
      const video = screen.getByTestId('video-element') as HTMLVideoElement

      mockBoundingRect(volumeSlider)

      // MouseDown starts the inline drag handler and sets initial volume
      fireEvent.mouseDown(volumeSlider, { clientX: 30 })
      expect(video.volume).toBe(0.3)

      // Drag via document mousemove (registered in inline handler)
      fireEvent.mouseMove(document, { clientX: 60 })
      expect(video.volume).toBe(0.6)

      // MouseUp cleans up the listeners
      fireEvent.mouseUp(document)

      // After mouseUp, further moves should not affect volume
      fireEvent.mouseMove(document, { clientX: 10 })
      expect(video.volume).toBe(0.6)
    })

    it('should clamp volume slider to max 1', () => {
      render(<VideoPlayer src={mockSrc} />)
      const volumeSlider = screen.getByTestId('video-volume-slider')
      const video = screen.getByTestId('video-element') as HTMLVideoElement

      mockBoundingRect(volumeSlider)

      // Click beyond slider range — should clamp to 1
      fireEvent.click(volumeSlider, { clientX: 200 })
      expect(video.volume).toBe(1)
    })

    it('should handle global mouse move when not dragging (no-op)', () => {
      render(<VideoPlayer src={mockSrc} />)
      const video = screen.getByTestId('video-element') as HTMLVideoElement

      // Global mouse move without any drag — should not change anything
      fireEvent.mouseMove(document, { clientX: 50 })
      expect(video.currentTime).toBe(0)
    })
  })
})
