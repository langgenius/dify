'use client'
import { useRef, useState } from 'react'
import { t } from 'i18next'
import { useParams, usePathname } from 'next/navigation'
import s from './style.module.css'
import Tooltip from '@/app/components/base/tooltip'
import { randomString } from '@/utils'
import Loading from '@/app/components/base/loading'
import { AudioPlayerManager } from '@/app/components/base/audio-btn/audio.player.manager'

type AudioBtnProps = {
  id?: string
  voice?: string
  value?: string
  className?: string
  isAudition?: boolean
  noCache?: boolean
}

type AudioState = 'initial' | 'loading' | 'playing' | 'paused' | 'ended'

const AudioBtn = ({
  id,
  voice,
  value,
  className,
  isAudition,
}: AudioBtnProps) => {
  const [audioState, setAudioState] = useState<AudioState>('initial')

  const selector = useRef(`play-tooltip-${randomString(4)}`)
  const params = useParams()
  const pathname = usePathname()
  const audio_finished_call = (event: string): any => {
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
  }
  else if (params.appId) {
    if (pathname.search('explore/installed') > -1)
      url = `/installed-apps/${params.appId}/text-to-audio`
    else
      url = `/apps/${params.appId}/text-to-audio`
  }
  const handleToggle = async () => {
    if (audioState === 'playing' || audioState === 'loading') {
      setTimeout(() => setAudioState('paused'), 1)
      AudioPlayerManager.getInstance().getAudioPlayer(url, isPublic, id, value, voice, audio_finished_call).pauseAudio()
    }
    else {
      setTimeout(() => setAudioState('loading'), 1)
      AudioPlayerManager.getInstance().getAudioPlayer(url, isPublic, id, value, voice, audio_finished_call).playAudio()
    }
  }

  const tooltipContent = {
    initial: t('appApi.play'),
    ended: t('appApi.play'),
    paused: t('appApi.pause'),
    playing: t('appApi.playing'),
    loading: t('appApi.loading'),
  }[audioState]

  return (
    <div className={`${(audioState === 'loading' || audioState === 'playing') ? 'mr-1' : className}`}>
      <Tooltip
        selector={selector.current}
        content={tooltipContent}
        className='z-10'
      >
        <button
          disabled={audioState === 'loading'}
          className={`box-border p-0.5 flex items-center justify-center cursor-pointer ${isAudition || '!p-0 rounded-md bg-white'}`}
          onClick={handleToggle}
        >
          {audioState === 'loading'
            ? (
              <div className='w-6 h-6 rounded-md flex items-center justify-center p-2'>
                <Loading />
              </div>
            )
            : (
              <div className={`w-6 h-6 rounded-md ${!isAudition ? 'w-4 h-4 hover:bg-gray-50' : 'hover:bg-gray-50'} ${(audioState === 'playing') ? s.pauseIcon : s.playIcon}`}></div>
            )}
        </button>
      </Tooltip>
    </div>
  )
}

export default AudioBtn
