'use client'
import { useEffect, useRef, useState } from 'react'
import { t } from 'i18next'
import { useParams, usePathname } from 'next/navigation'
import s from './style.module.css'
import Tooltip from '@/app/components/base/tooltip'
import { randomString } from '@/utils'
import { textToAudio } from '@/service/share'

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
        setAudioState('playing')
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
    const handlePaused = () => {
      setAudioState('paused')
    }
    const handleEnded = () => {
      setAudioState('ended')
    }
    currentAudio?.addEventListener('progress', handleLoading)
    currentAudio?.addEventListener('canplaythrough', handlePlay)
    currentAudio?.addEventListener('paused', handlePaused)
    currentAudio?.addEventListener('ended', handleEnded)
    return () => {
      if (currentAudio) {
        currentAudio.removeEventListener('progress', handleLoading)
        currentAudio.removeEventListener('canplaythrough', handlePlay)
        currentAudio.removeEventListener('paused', handlePaused)
        currentAudio.removeEventListener('ended', handleEnded)
        currentAudio.src = ''
      }
    }
  }, [])

  let tooltipContent = t('appApi.play')
  if (audioState === 'loading')
    tooltipContent = 'loading...' // todo: i18
  else if (audioState === 'playing')
    tooltipContent = t('appApi.playing')
  else if (audioState === 'paused')
    tooltipContent = t('appApi.pause')

  return (
    <div className={`${(audioState === 'playing') ? 'mr-1' : className}`}>
      <Tooltip
        selector={selector.current}
        content={tooltipContent}
        className='z-10'
      >
        <button
          disabled={audioState === 'loading'}
          className={`box-border p-0.5 flex items-center justify-center cursor-pointer ${isAudition || 'rounded-md bg-white'}`}
          style={{ boxShadow: !isAudition ? '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)' : '' }}
          onClick={handleToggle}>
          {audioState === 'loading' && <div className='w-6 h-6 rounded-md flex items-center justify-center'><span className={s.loader}></span></div>}
          {audioState !== 'loading' && <div className={`w-6 h-6 rounded-md ${!isAudition ? 'hover:bg-gray-200' : 'hover:bg-gray-50'} ${(audioState === 'playing') ? s.pauseIcon : s.playIcon}`}></div>}
        </button>
      </Tooltip>
      <audio ref={audioRef} src='' className='hidden' />
    </div>
  )
}

export default AudioBtn
