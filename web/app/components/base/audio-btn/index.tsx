'use client'
import { useRef, useState } from 'react'
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

const AudioBtn = ({
  value,
  voice,
  className,
  isAudition,
}: AudioBtnProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPause, setPause] = useState(false)
  const [hasEnded, setHasEnded] = useState(false)
  const selector = useRef(`play-tooltip-${randomString(4)}`)
  const params = useParams()
  const pathname = usePathname()
  const removeCodeBlocks = (inputText: any) => {
    const codeBlockRegex = /```[\s\S]*?```/g
    if (inputText)
      return inputText.replace(codeBlockRegex, '')
    return ''
  }

  const playAudio = async () => {
    const formData = new FormData()
    if (value !== '') {
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
        const audio = new Audio(audioUrl)
        audioRef.current = audio
        audio.play().then(() => {}).catch(() => {
          setIsPlaying(false)
          URL.revokeObjectURL(audioUrl)
        })
        audio.onended = () => {
          setHasEnded(true)
          setIsPlaying(false)
        }
      }
      catch (error) {
        setIsPlaying(false)
        console.error('Error playing audio:', error)
      }
    }
  }
  const togglePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        if (!hasEnded) {
          setPause(false)
          audioRef.current.play()
        }
        if (!isPause) {
          setPause(true)
          audioRef.current.pause()
        }
      }
      else if (!isPlaying) {
        if (isPause) {
          setPause(false)
          audioRef.current.play()
        }
        else {
          setHasEnded(false)
          playAudio().then()
        }
      }
      setIsPlaying(prevIsPlaying => !prevIsPlaying)
    }
    else {
      setIsPlaying(true)
      if (!isPlaying)
        playAudio().then()
    }
  }

  return (
    <div className={`${(isPlaying && !hasEnded) ? 'mr-1' : className}`}>
      <Tooltip
        selector={selector.current}
        content={(!isPause ? ((isPlaying && !hasEnded) ? t('appApi.playing') : t('appApi.play')) : t('appApi.pause')) as string}
        className='z-10'
      >
        <div
          className={`box-border p-0.5 flex items-center justify-center cursor-pointer ${isAudition || 'rounded-md bg-white'}`}
          style={{ boxShadow: !isAudition ? '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)' : '' }}
          onClick={togglePlayPause}>
          <div className={`w-6 h-6 rounded-md ${!isAudition ? 'hover:bg-gray-200' : 'hover:bg-gray-50'} ${(isPlaying && !hasEnded) ? s.pauseIcon : s.playIcon}`}></div>
        </div>
      </Tooltip>
    </div>
  )
}

export default AudioBtn
