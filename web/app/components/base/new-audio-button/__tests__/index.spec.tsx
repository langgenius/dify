import type { i18n } from 'i18next'
import type { ReactElement } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import appApi from '@/i18n/locales/en-US/app-api.json'
import { useParams, usePathname } from '@/next/navigation'
import AudioBtn from '../index'

vi.unmock('react-i18next')

const mockPlayAudio = vi.fn()
const mockPauseAudio = vi.fn()
const mockGetAudioPlayer = vi.fn()

vi.mock('@/next/navigation', () => ({
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
  let i18n: i18n

  const renderAudioButton = (ui: ReactElement) =>
    render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)

  const getButton = () => screen.getByRole('button')

  const hoverAndCheckTooltip = async (
    user: ReturnType<typeof userEvent.setup>,
    expectedText: string,
  ) => {
    const button = getButton()
    await user.unhover(button)
    await user.hover(button)
    expect(await screen.findByText(expectedText))!.toBeInTheDocument()
  }

  const getAudioCallback = () => {
    const lastCall = mockGetAudioPlayer.mock.calls[mockGetAudioPlayer.mock.calls.length - 1]
    const callback = lastCall?.find((arg: unknown) => typeof arg === 'function') as
      | ((event: string) => void)
      | undefined
    if (!callback)
      throw new Error(
        'Audio callback not found - ensure mockGetAudioPlayer was called with a callback argument',
      )
    return callback
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetAudioPlayer.mockReturnValue({
      playAudio: mockPlayAudio,
      pauseAudio: mockPauseAudio,
    })
    ;(useParams as ReturnType<typeof vi.fn>).mockReturnValue({})
    ;(usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/')
    i18n = createInstance()
    await i18n.init({
      lng: 'en-US',
      fallbackLng: 'en-US',
      defaultNS: 'appApi',
      resources: { 'en-US': { appApi } },
    })
  })

  describe('URL Routing', () => {
    it('should generate public URL when token is present', async () => {
      const user = userEvent.setup()
      ;(useParams as ReturnType<typeof vi.fn>).mockReturnValue({ token: 'test-token' })

      renderAudioButton(<AudioBtn value="test" />)
      await user.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      expect(mockGetAudioPlayer.mock.calls[0]![0]).toBe('/text-to-audio')
      expect(mockGetAudioPlayer.mock.calls[0]![1]).toBe(true)
    })

    it('should generate app URL when appId is present', async () => {
      const user = userEvent.setup()
      ;(useParams as ReturnType<typeof vi.fn>).mockReturnValue({ appId: '123' })
      ;(usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/apps/123/chat')

      renderAudioButton(<AudioBtn value="test" />)
      await user.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      expect(mockGetAudioPlayer.mock.calls[0]![0]).toBe('/apps/123/text-to-audio')
      expect(mockGetAudioPlayer.mock.calls[0]![1]).toBe(false)
    })

    it('should generate installed app URL correctly', async () => {
      const user = userEvent.setup()
      ;(useParams as ReturnType<typeof vi.fn>).mockReturnValue({ appId: '456' })
      ;(usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/installed/456')

      renderAudioButton(<AudioBtn value="test" />)
      await user.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      expect(mockGetAudioPlayer.mock.calls[0]![0]).toBe('/installed-apps/456/text-to-audio')
    })
  })

  describe('State Management', () => {
    it('should name the initial action using the provider instance without initializing the default instance', async () => {
      const user = userEvent.setup()
      renderAudioButton(<AudioBtn value="test" />)

      await hoverAndCheckTooltip(user, 'Play')
      expect(getButton()).toHaveAccessibleName('Play')
      expect(getButton()).not.toBeDisabled()
    })

    it('should transition to playing state', async () => {
      const user = userEvent.setup()
      renderAudioButton(<AudioBtn value="test" />)
      await user.click(getButton())

      act(() => {
        getAudioCallback()('play')
      })

      await hoverAndCheckTooltip(user, 'Pause')
      expect(getButton()).toHaveAccessibleName('Pause')
    })

    it('should transition to ended state', async () => {
      const user = userEvent.setup()
      renderAudioButton(<AudioBtn value="test" />)
      await user.click(getButton())

      act(() => {
        getAudioCallback()('play')
      })
      act(() => {
        getAudioCallback()('ended')
      })

      await hoverAndCheckTooltip(user, 'Play')
      expect(getButton()).toHaveAccessibleName('Play')
    })

    it('should handle paused event', async () => {
      const user = userEvent.setup()
      renderAudioButton(<AudioBtn value="test" />)
      await user.click(getButton())

      act(() => {
        getAudioCallback()('play')
      })
      act(() => {
        getAudioCallback()('paused')
      })

      await hoverAndCheckTooltip(user, 'Play')
    })

    it('should handle error event', async () => {
      const user = userEvent.setup()
      renderAudioButton(<AudioBtn value="test" />)
      await user.click(getButton())

      act(() => {
        getAudioCallback()('error')
      })

      await hoverAndCheckTooltip(user, 'Play')
    })

    it('should handle loaded event', async () => {
      const user = userEvent.setup()
      renderAudioButton(<AudioBtn value="test" />)
      await user.click(getButton())

      act(() => {
        getAudioCallback()('loaded')
      })

      await hoverAndCheckTooltip(user, 'Loading')
    })
  })

  describe('Play/Pause', () => {
    it('should call playAudio when clicked', async () => {
      const user = userEvent.setup()
      renderAudioButton(<AudioBtn value="test" />)
      await user.click(getButton())

      await waitFor(() => expect(mockPlayAudio).toHaveBeenCalled())
    })

    it('should call pauseAudio when clicked while playing', async () => {
      const user = userEvent.setup()
      renderAudioButton(<AudioBtn value="test" />)
      await user.click(getButton())

      act(() => {
        getAudioCallback()('play')
      })

      await user.click(screen.getByRole('button', { name: 'Pause' }))
      await waitFor(() => expect(mockPauseAudio).toHaveBeenCalled())
      expect(await screen.findByRole('button', { name: 'Play' })).toBeEnabled()
      await user.click(screen.getByRole('button', { name: 'Play' }))
      expect(mockPlayAudio).toHaveBeenCalledTimes(2)
    })

    it('should disable button when loading', async () => {
      const user = userEvent.setup()
      renderAudioButton(<AudioBtn value="test" />)
      await user.click(getButton())

      expect(await screen.findByRole('button', { name: 'Loading' })).toBeDisabled()
    })
  })

  describe('Props', () => {
    it('should pass props to audio player', async () => {
      const user = userEvent.setup()
      renderAudioButton(<AudioBtn value="hello" id="msg-1" voice="en-US" />)
      await user.click(getButton())

      await waitFor(() => expect(mockGetAudioPlayer).toHaveBeenCalled())
      const call = mockGetAudioPlayer.mock.calls[0]
      expect(call![2]).toBe('msg-1')
      expect(call![3]).toBe('hello')
      expect(call![4]).toBe('en-US')
    })
  })
})
