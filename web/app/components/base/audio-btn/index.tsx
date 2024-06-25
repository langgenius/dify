'use client'
import { useRef, useState } from 'react'
import { t } from 'i18next'
import { useParams, usePathname } from 'next/navigation'
import s from './style.module.css'
import Tooltip from '@/app/components/base/tooltip'
import { randomString } from '@/utils'
import { textToAudioStream } from '@/service/share'
import Loading from '@/app/components/base/loading'
import { type AudioPlayer, getAudioPlayer } from '@/app/components/base/audio-btn/audio'
import { useChatContext } from '@/app/components/base/chat/chat/context'

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
  const {
    config: chatContextConfig,
  } = useChatContext()
  const voiceRef = useRef(chatContextConfig?.text_to_speech?.voice)
  const audioPlayerRef = useRef<AudioPlayer | null>(null)
  const audio_finished_call = () => {
    setAudioState('ended')
  }
  const loadAudio = async () => {
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
    try {
      const voice_value = voice || voiceRef.current
      const audioResponse: any = await textToAudioStream(url, isPublic, {
        message_id: id,
        streaming: true,
        voice: voice_value,
        text: value,
      })
      const reader = audioResponse.body.getReader() // 获取reader
      const audioPlayer = getAudioPlayer(id, audio_finished_call, true)
      audioPlayerRef.current = audioPlayer
      while (true) {
        const { value, done } = await reader.read()

        if (done) {
          audioPlayer.finishReceiver()
          break
        }
        setAudioState('playing')
        audioPlayer.receiveAudioData(value)
      }
    }

    catch (error) {
      console.error('Error playing audio:', error)
      setAudioState('ended')
    }
  }

  const handleToggle = async () => {
    let audioPlayer: AudioPlayer | null = null
    if (audioState === 'playing') {
      setAudioState('paused')
      audioPlayer = getAudioPlayer(id, audio_finished_call)
      audioPlayer.stop()
    }
    else {
      setAudioState('playing')
      await loadAudio()
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
