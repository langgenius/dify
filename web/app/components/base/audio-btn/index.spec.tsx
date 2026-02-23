import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { useParams, usePathname } from 'next/navigation'
import AudioBtn from './index'

const mockPlayAudio = vi.fn()
const mockPauseAudio = vi.fn()
const mockGetAudioPlayer = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  usePathname: vi.fn(),
}))

vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: vi.fn(() => ({
      getAudioPlayer: mockGetAudioPlayer,
    })),
  },
}))

describe('AudioBtn', () => {
  const getButton = () => screen.getByRole('button')
  const mockUseParams = (value: Partial<Record<string, string>>) => {
    vi.mocked(useParams).mockReturnValue(value as ReturnType<typeof useParams>)
  }
  const mockUsePathname = (value: string) => {
    vi.mocked(usePathname).mockReturnValue(value)
  }

  const hoverAndCheckTooltip = async (expectedText: string) => {
    await userEvent.hover(getButton())
    expect(await screen.findByText(expectedText)).toBeInTheDocument()
  }

  const getLatestAudioCallback = () => {
    const lastCall = mockGetAudioPlayer.mock.calls[mockGetAudioPlayer.mock.calls.length - 1]
    const callback = lastCall?.[5]

    if (typeof callback !== 'function')
      throw new Error('Audio callback not found in latest getAudioPlayer call')

    return callback as (event: string) => void
  }

  beforeAll(async () => {
    await i18next.init({})
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAudioPlayer.mockReturnValue({
      playAudio: mockPlayAudio,
      pauseAudio: mockPauseAudio,
    })
    mockUseParams({})
    mockUsePathname('/')
  })

  // Core rendering and base UI integration.
  describe('Rendering', () => {
    it('should render button with play tooltip by default', async () => {
      render(<AudioBtn value="hello" />)

      expect(getButton()).toBeInTheDocument()
      expect(getButton()).not.toBeDisabled()
      await hoverAndCheckTooltip('play')
    })

    it('should apply className in initial state', () => {
      const { container } = render(<AudioBtn value="hello" className="custom-wrapper" />)
      const wrapper = container.firstElementChild

      expect(wrapper).toHaveClass('custom-wrapper')
    })
  })

  // URL path resolution for app/public audio endpoints.
  describe('URL routing', () => {
    it('should call public text-to-audio endpoint when token exists', async () => {
      mockUseParams({ token: 'public-token' })

      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      const call = mockGetAudioPlayer.mock.calls[0]
      expect(call[0]).toBe('/text-to-audio')
      expect(call[1]).toBe(true)
    })

    it('should call app endpoint when appId exists', async () => {
      mockUseParams({ appId: '123' })
      mockUsePathname('/apps/123/chat')

      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      const call = mockGetAudioPlayer.mock.calls[0]
      expect(call[0]).toBe('/apps/123/text-to-audio')
      expect(call[1]).toBe(false)
    })

    it('should call installed app endpoint for explore installed routes', async () => {
      mockUseParams({ appId: '456' })
      mockUsePathname('/explore/installed/app/456')

      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      const call = mockGetAudioPlayer.mock.calls[0]
      expect(call[0]).toBe('/installed-apps/456/text-to-audio')
      expect(call[1]).toBe(false)
    })
  })

  // User-visible playback state transitions.
  describe('Playback interactions', () => {
    it('should start loading and call playAudio when button is clicked', async () => {
      render(<AudioBtn value="test" className="custom-wrapper" />)
      await userEvent.click(getButton())

      await waitFor(() => {
        expect(mockPlayAudio).toHaveBeenCalledTimes(1)
        expect(getButton()).toBeDisabled()
      })
      expect(screen.getByRole('status')).toBeInTheDocument()
      await hoverAndCheckTooltip('loading')
    })

    it('should pause audio when clicked while playing', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      await act(() => {
        getLatestAudioCallback()('play')
      })

      await hoverAndCheckTooltip('playing')
      expect(getButton()).not.toBeDisabled()

      await userEvent.click(getButton())
      await waitFor(() => expect(mockPauseAudio).toHaveBeenCalledTimes(1))
    })
  })

  // Audio event callback handling from the player manager.
  describe('Audio callback events', () => {
    it('should set loading tooltip when loaded event is received', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      await act(() => {
        getLatestAudioCallback()('loaded')
      })

      await hoverAndCheckTooltip('loading')
      expect(getButton()).toBeDisabled()
    })

    it.each(['ended', 'paused', 'error'])('should return to play tooltip when %s event is received', async (event) => {
      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      await act(() => {
        getLatestAudioCallback()(event)
      })

      await hoverAndCheckTooltip('play')
      expect(getButton()).not.toBeDisabled()
    })
  })

  // Prop forwarding and minimal-input behavior.
  describe('Props and edge cases', () => {
    it('should pass id, value, and voice to getAudioPlayer', async () => {
      render(<AudioBtn id="msg-1" value="hello" voice="en-US" />)
      await userEvent.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      const call = mockGetAudioPlayer.mock.calls[0]
      expect(call[2]).toBe('msg-1')
      expect(call[3]).toBe('hello')
      expect(call[4]).toBe('en-US')
    })

    it('should keep empty route when neither token nor appId is present', async () => {
      render(<AudioBtn />)
      await userEvent.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      const call = mockGetAudioPlayer.mock.calls[0]
      expect(call[0]).toBe('')
      expect(call[1]).toBe(false)
      expect(call[3]).toBeUndefined()
    })
  })
})
