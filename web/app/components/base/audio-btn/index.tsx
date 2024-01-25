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
  className?: string
}

const AudioBtn = ({
  value,
  className,
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
    return inputText.replace(codeBlockRegex, '')
  }

  const playAudio = async () => {
    const formData = new FormData()
    if (value !== '') {
      formData.append('text', removeCodeBlocks(value))

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
        audio.play().then(() => {
          setIsPlaying(true)
        }).catch(() => {
          setIsPlaying(false)
          URL.revokeObjectURL(audioUrl)
        })
        audio.onended = () => setHasEnded(true)
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
        setPause(true)
        audioRef.current.pause()
      }
      else if (!hasEnded) {
        setPause(false)
        audioRef.current.play()
      }
      else if (!isPlaying) {
        playAudio().then()
      }
      setIsPlaying(prevIsPlaying => !prevIsPlaying)
    }
    else {
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
          className={'box-border p-0.5 flex items-center justify-center rounded-md bg-white cursor-pointer'}
          style={{ boxShadow: '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)' }}
          onClick={togglePlayPause}>
          <div className={`w-6 h-6 rounded-md hover:bg-gray-50 ${!isPause ? ((isPlaying && !hasEnded) ? s.playIcon : s.stopIcon) : s.pauseIcon}`}></div>
        </div>
      </Tooltip>
    </div>
  )
}

export default AudioBtn
