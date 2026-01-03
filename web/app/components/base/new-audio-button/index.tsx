'use client'
import {
  RiVolumeUpLine,
} from '@remixicon/react'
import { t } from 'i18next'
import { useParams, usePathname } from 'next/navigation'
import { useState } from 'react'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import { AudioPlayerManager } from '@/app/components/base/audio-btn/audio.player.manager'
import Tooltip from '@/app/components/base/tooltip'

type AudioBtnProps = {
  id?: string
  voice?: string
  value?: string
}

type AudioState = 'initial' | 'loading' | 'playing' | 'paused' | 'ended'

const AudioBtn = ({
  id,
  voice,
  value,
}: AudioBtnProps) => {
  const [audioState, setAudioState] = useState<AudioState>('initial')

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
    initial: t('play', { ns: 'appApi' }),
    ended: t('play', { ns: 'appApi' }),
    paused: t('pause', { ns: 'appApi' }),
    playing: t('playing', { ns: 'appApi' }),
    loading: t('loading', { ns: 'appApi' }),
  }[audioState]

  return (
    <Tooltip
      popupContent={tooltipContent}
    >
      <ActionButton
        state={
          audioState === 'loading' || audioState === 'playing'
            ? ActionButtonState.Active
            : ActionButtonState.Default
        }
        onClick={handleToggle}
        disabled={audioState === 'loading'}
      >
        <RiVolumeUpLine className="h-4 w-4" />
      </ActionButton>
    </Tooltip>
  )
}

export default AudioBtn
