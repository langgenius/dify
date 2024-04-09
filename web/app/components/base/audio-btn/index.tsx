'use client'
import { useEffect, useRef, useState } from 'react'
import { t } from 'i18next'
import { useParams, usePathname } from 'next/navigation'
import s from './style.module.css'
import Tooltip from '@/app/components/base/tooltip'
import { randomString } from '@/utils'
import { textToAudio } from '@/service/share'
import Loading from '@/app/components/base/loading'

type AudioBtnProps = {
  value: string
  voice?: string
  className?: string
  isAudition?: boolean
}

type AudioState = 'initial' | 'loading' | 'playing' | 'paused' | 'ended'

const AudioBtn = ({
  value,
  voice,
  className,
  isAudition,
}: AudioBtnProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [audioState, setAudioState] = useState<AudioState>('initial')

  const selector = useRef(`play-tooltip-${randomString(4)}`)
  const params = useParams()
  const pathname = usePathname()
  const removeCodeBlocks = (inputText: any) => {
    const codeBlockRegex = /```[\s\S]*?```/g
    if (inputText)
      return inputText.replace(codeBlockRegex, '')
    return ''
  }

  const loadAudio = async () => {
    const formData = new FormData()
    if (value !== '') {
      setAudioState('loading')

      formData.append('text', removeCodeBlocks(value))
      formData.append('voice', removeCodeBlocks(voice))

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
        const audioResponse = await textToAudio(url, isPublic, formData)
        const blob_bytes = Buffer.from(audioResponse.data, 'latin1')
        const blob = new Blob([blob_bytes], { type: 'audio/wav' })
        const audioUrl = URL.createObjectURL(blob)
        audioRef.current!.src = audioUrl
      }
      catch (error) {
        setAudioState('initial')
        console.error('Error playing audio:', error)
      }
    }
  }

  const handleToggle = () => {
    if (audioState === 'initial')
      loadAudio()
    if (audioRef.current) {
      if (audioState === 'playing') {
        audioRef.current.pause()
        setAudioState('paused')
      }
      else if (audioState === 'paused' || audioState === 'ended') {
        audioRef.current.play()
        setAudioState('playing')
      }
    }
  }

  useEffect(() => {
    const currentAudio = audioRef.current
    const handleLoading = () => {
      setAudioState('loading')
    }
    const handlePlay = () => {
      currentAudio?.play()
      setAudioState('playing')
    }
    const handleEnded = () => {
      setAudioState('ended')
    }
    currentAudio?.addEventListener('progress', handleLoading)
    currentAudio?.addEventListener('canplaythrough', handlePlay)
    currentAudio?.addEventListener('ended', handleEnded)
    return () => {
      if (currentAudio) {
        currentAudio.removeEventListener('progress', handleLoading)
        currentAudio.removeEventListener('canplaythrough', handlePlay)
        currentAudio.removeEventListener('ended', handleEnded)
        URL.revokeObjectURL(currentAudio.src)
        currentAudio.src = ''
      }
    }
  }, [])

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
          onClick={handleToggle}>
          {audioState === 'loading' && <div className='w-6 h-6 rounded-md flex items-center justify-center p-2'><Loading /></div>}
          {audioState !== 'loading' && <div className={`w-6 h-6 rounded-md ${!isAudition ? 'w-4 h-4 hover:bg-gray-50' : 'hover:bg-gray-50'} ${(audioState === 'playing') ? s.pauseIcon : s.playIcon}`}></div>}
        </button>
      </Tooltip>
      <audio ref={audioRef} src='' className='hidden' />
    </div>
  )
}

export default AudioBtn
