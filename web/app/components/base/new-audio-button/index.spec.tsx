import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useParams, usePathname } from 'next/navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AudioBtn from './index'

const mockPlayAudio = vi.fn()
const mockPauseAudio = vi.fn()
const mockGetAudioPlayer = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  usePathname: vi.fn(),
}))

vi.mock('i18next', () => ({
  t: vi.fn(key => key),
}))

vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: vi.fn(() => ({
      getAudioPlayer: mockGetAudioPlayer,
    })),
  },
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: { children: React.ReactNode, popupContent: string }) => (
    <div data-testid="tooltip-wrapper" data-popup={popupContent}>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/base/action-button', () => ({
  ActionButtonState: { Active: 'active', Default: 'default' },
  default: ({ children, onClick, state, disabled }: { children: React.ReactNode, onClick: () => void, state: string, disabled: boolean }) => (
    <button
      data-testid="action-button"
      data-state={state}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}))

describe('AudioBtn', () => {
  const getAudioCallback = () => {
    const lastCall = mockGetAudioPlayer.mock.calls[mockGetAudioPlayer.mock.calls.length - 1]
    const callback = lastCall?.find((arg: unknown) => typeof arg === 'function') as ((event: string) => void) | undefined
    if (!callback)
      throw new Error('Audio callback not found - ensure mockGetAudioPlayer was called with a callback argument')
    return callback
  }

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
      await userEvent.click(screen.getByTestId('action-button'))

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      expect(mockGetAudioPlayer.mock.calls[0][0]).toBe('/text-to-audio')
      expect(mockGetAudioPlayer.mock.calls[0][1]).toBe(true)
    })

    it('should generate app URL when appId is present', async () => {
      ; (useParams as ReturnType<typeof vi.fn>).mockReturnValue({ appId: '123' })
      ; (usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/apps/123/chat')

      render(<AudioBtn value="test" />)
      await userEvent.click(screen.getByTestId('action-button'))

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      expect(mockGetAudioPlayer.mock.calls[0][0]).toBe('/apps/123/text-to-audio')
      expect(mockGetAudioPlayer.mock.calls[0][1]).toBe(false)
    })

    it('should generate installed app URL correctly', async () => {
      ; (useParams as ReturnType<typeof vi.fn>).mockReturnValue({ appId: '456' })
      ; (usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/explore/installed/app')

      render(<AudioBtn value="test" />)
      await userEvent.click(screen.getByTestId('action-button'))

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      expect(mockGetAudioPlayer.mock.calls[0][0]).toBe('/installed-apps/456/text-to-audio')
    })
  })

  describe('State Management', () => {
    it('should start in initial state', () => {
      render(<AudioBtn value="test" />)

      expect(screen.getByTestId('tooltip-wrapper')).toHaveAttribute('data-popup', 'play')
      expect(screen.getByTestId('action-button')).toHaveAttribute('data-state', 'default')
      expect(screen.getByTestId('action-button')).not.toBeDisabled()
    })

    it('should transition to playing state', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(screen.getByTestId('action-button'))

      act(() => {
        getAudioCallback()('play')
      })

      await waitFor(() =>
        expect(screen.getByTestId('tooltip-wrapper')).toHaveAttribute('data-popup', 'playing'),
      )
      expect(screen.getByTestId('action-button')).toHaveAttribute('data-state', 'active')
    })

    it('should transition to ended state', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(screen.getByTestId('action-button'))

      act(() => {
        getAudioCallback()('play')
      })
      act(() => {
        getAudioCallback()('ended')
      })

      await waitFor(() =>
        expect(screen.getByTestId('tooltip-wrapper')).toHaveAttribute('data-popup', 'play'),
      )
      expect(screen.getByTestId('action-button')).toHaveAttribute('data-state', 'default')
    })

    it('should handle paused event', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(screen.getByTestId('action-button'))

      act(() => {
        getAudioCallback()('play')
      })
      act(() => {
        getAudioCallback()('paused')
      })

      await waitFor(() =>
        expect(screen.getByTestId('tooltip-wrapper')).toHaveAttribute('data-popup', 'play'),
      )
    })

    it('should handle error event', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(screen.getByTestId('action-button'))

      act(() => {
        getAudioCallback()('error')
      })

      await waitFor(() =>
        expect(screen.getByTestId('tooltip-wrapper')).toHaveAttribute('data-popup', 'play'),
      )
    })

    it('should handle loaded event', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(screen.getByTestId('action-button'))

      act(() => {
        getAudioCallback()('loaded')
      })

      await waitFor(() =>
        expect(screen.getByTestId('tooltip-wrapper')).toHaveAttribute('data-popup', 'loading'),
      )
    })
  })

  describe('Play/Pause', () => {
    it('should call playAudio when clicked', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(screen.getByTestId('action-button'))

      await waitFor(() => expect(mockPlayAudio).toHaveBeenCalled())
    })

    it('should call pauseAudio when clicked while playing', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(screen.getByTestId('action-button'))

      act(() => {
        getAudioCallback()('play')
      })

      await userEvent.click(screen.getByTestId('action-button'))
      await waitFor(() => expect(mockPauseAudio).toHaveBeenCalled())
    })

    it('should disable button when loading', async () => {
      render(<AudioBtn value="test" />)
      await userEvent.click(screen.getByTestId('action-button'))

      await waitFor(() => expect(screen.getByTestId('action-button')).toBeDisabled())
    })
  })

  describe('Props', () => {
    it('should pass props to audio player', async () => {
      render(<AudioBtn value="hello" id="msg-1" voice="en-US" />)
      await userEvent.click(screen.getByTestId('action-button'))

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      const call = mockGetAudioPlayer.mock.calls[0]
      expect(call[2]).toBe('msg-1')
      expect(call[3]).toBe('hello')
      expect(call[4]).toBe('en-US')
    })
  })
})
