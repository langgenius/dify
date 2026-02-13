import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { useParams, usePathname } from 'next/navigation'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

  const hoverAndCheckTooltip = async (expectedText: string) => {
    const button = getButton()
    await userEvent.hover(button)
    expect(await screen.findByText(expectedText)).toBeInTheDocument()
  }

  const getAudioCallback = () => {
    const lastCall = mockGetAudioPlayer.mock.calls[mockGetAudioPlayer.mock.calls.length - 1]
    const callback = lastCall?.find((arg: unknown) => typeof arg === 'function') as ((event: string) => void) | undefined
    if (!callback)
      throw new Error('Audio callback not found - ensure mockGetAudioPlayer was called with a callback argument')
    return callback
  }

  beforeAll(() => {
    i18next.init({})
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAudioPlayer.mockReturnValue({
      playAudio: mockPlayAudio,
      pauseAudio: mockPauseAudio,
    })
    ; (useParams as ReturnType<typeof vi.fn>).mockReturnValue({})
    ; (usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/')
  })

  describe('URL Routing', () => {
    it('should generate public URL when token is present', async () => {
      ; (useParams as ReturnType<typeof vi.fn>).mockReturnValue({ token: 'test-token' })

      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      expect(mockGetAudioPlayer.mock.calls[0][0]).toBe('/text-to-audio')
      expect(mockGetAudioPlayer.mock.calls[0][1]).toBe(true)
    })

    it('should generate app URL when appId is present', async () => {
      ; (useParams as ReturnType<typeof vi.fn>).mockReturnValue({ appId: '123' })
      ; (usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/apps/123/chat')

      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      expect(mockGetAudioPlayer.mock.calls[0][0]).toBe('/apps/123/text-to-audio')
      expect(mockGetAudioPlayer.mock.calls[0][1]).toBe(false)
    })

    it('should generate installed app URL correctly', async () => {
      ; (useParams as ReturnType<typeof vi.fn>).mockReturnValue({ appId: '456' })
      ; (usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/explore/installed/app')

      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      expect(mockGetAudioPlayer.mock.calls[0][0]).toBe('/installed-apps/456/text-to-audio')
    })
  })

  describe('State Management', () => {
    it('should start in initial state', async () => {
      render(<AudioBtn value="test" />)

      await hoverAndCheckTooltip('play')
      expect(getButton()).toHaveClass('action-btn')
      expect(getButton()).not.toBeDisabled()
    })

    it('should transition to playing state', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      act(() => {
        getAudioCallback()('play')
      })

      await hoverAndCheckTooltip('playing')
      expect(getButton()).toHaveClass('action-btn-active')
    })

    it('should transition to ended state', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      act(() => {
        getAudioCallback()('play')
      })
      act(() => {
        getAudioCallback()('ended')
      })

      await hoverAndCheckTooltip('play')
      expect(getButton()).not.toHaveClass('action-btn-active')
    })

    it('should handle paused event', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      act(() => {
        getAudioCallback()('play')
      })
      act(() => {
        getAudioCallback()('paused')
      })

      await hoverAndCheckTooltip('play')
    })

    it('should handle error event', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      act(() => {
        getAudioCallback()('error')
      })

      await hoverAndCheckTooltip('play')
    })

    it('should handle loaded event', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      act(() => {
        getAudioCallback()('loaded')
      })

      await hoverAndCheckTooltip('loading')
    })
  })

  describe('Play/Pause', () => {
    it('should call playAudio when clicked', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      await waitFor(() => expect(mockPlayAudio).toHaveBeenCalled())
    })

    it('should call pauseAudio when clicked while playing', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      act(() => {
        getAudioCallback()('play')
      })

      await userEvent.click(getButton())
      await waitFor(() => expect(mockPauseAudio).toHaveBeenCalled())
    })

    it('should disable button when loading', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(getButton())

      await waitFor(() => expect(getButton()).toBeDisabled())
    })
  })

  describe('Props', () => {
    it('should pass props to audio player', async () => {
      render(<AudioBtn value="hello" id="msg-1" voice="en-US" />)
      await userEvent.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      const call = mockGetAudioPlayer.mock.calls[0]
      expect(call[2]).toBe('msg-1')
      expect(call[3]).toBe('hello')
      expect(call[4]).toBe('en-US')
    })
  })
})
