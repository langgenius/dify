'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { t } from 'i18next'
import { useState } from 'react'
import { AudioPlayerManager } from '@/app/components/base/audio-btn/audio.player.manager'
import Loading from '@/app/components/base/loading'
import { isInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import { useParams, usePathname } from '@/next/navigation'

type AudioBtnProps = {
  id?: string
  voice?: string
  value?: string
  className?: string
  isAudition?: boolean
}

type AudioState = 'initial' | 'loading' | 'playing' | 'paused' | 'ended'

export function AudioBtn({ id, voice, value, className, isAudition }: AudioBtnProps) {
  const [audioState, setAudioState] = useState<AudioState>('initial')

  const params = useParams()
  const pathname = usePathname()
  const handleAudioEvent = (event: string): void => {
    switch (event) {
      case 'ended':
        setAudioState('ended')
        break
      case 'paused':
        setAudioState('ended')
        break
      case 'loaded':
        setAudioState('loading')
        break
      case 'play':
        setAudioState('playing')
        break
      case 'error':
        setAudioState('ended')
        break
    }
  }
  let url = ''
  let isPublic = false

  if (params.token) {
    url = '/text-to-audio'
    isPublic = true
  } else if (params.appId) {
    if (isInstalledAppPath(pathname)) url = `/installed-apps/${params.appId}/text-to-audio`
    else url = `/apps/${params.appId}/text-to-audio`
  }
  const handleToggle = () => {
    if (audioState === 'playing' || audioState === 'loading') {
      setTimeout(() => setAudioState('paused'), 1)
      AudioPlayerManager.getInstance()
        .getAudioPlayer(url, isPublic, id, value, voice, handleAudioEvent)
        .pauseAudio()
    } else {
      setTimeout(() => setAudioState('loading'), 1)
      AudioPlayerManager.getInstance()
        .getAudioPlayer(url, isPublic, id, value, voice, handleAudioEvent)
        .playAudio()
    }
  }

  const tooltipContent = {
    initial: t(($) => $.play, { ns: 'appApi' }),
    ended: t(($) => $.play, { ns: 'appApi' }),
    paused: t(($) => $.pause, { ns: 'appApi' }),
    playing: t(($) => $.playing, { ns: 'appApi' }),
    loading: t(($) => $.loading, { ns: 'appApi' }),
  }[audioState]

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center',
        audioState === 'loading' || audioState === 'playing' ? 'mr-1' : className,
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex">
              <button
                type="button"
                aria-label={tooltipContent}
                disabled={audioState === 'loading'}
                className={cn(
                  'box-border flex size-6 cursor-pointer items-center justify-center border-none bg-transparent',
                  isAudition ? 'p-0.5' : 'rounded-md bg-white p-0',
                )}
                onClick={handleToggle}
              >
                {audioState === 'loading' ? (
                  <div className="flex size-full items-center justify-center rounded-md">
                    <Loading />
                  </div>
                ) : (
                  <div className="flex size-full items-center justify-center rounded-md hover:bg-gray-50">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-4',
                        audioState === 'playing'
                          ? 'i-ri-pause-circle-fill'
                          : 'i-ri-play-large-fill',
                      )}
                    />
                  </div>
                )}
              </button>
            </span>
          }
        />
        <TooltipContent>{tooltipContent}</TooltipContent>
      </Tooltip>
    </div>
  )
}
