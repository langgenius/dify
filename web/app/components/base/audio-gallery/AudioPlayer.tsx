import React, { useCallback, useEffect, useRef, useState } from 'react'
import { t } from 'i18next'
import {
  RiPauseCircleFill,
  RiPlayLargeFill,
} from '@remixicon/react'
import Toast from '@/app/components/base/toast'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import cn from '@/utils/classnames'

type AudioPlayerProps = {
  src: string
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ src }) => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [waveformData, setWaveformData] = useState<number[]>([])
  const [bufferedTime, setBufferedTime] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false)
  const [hoverTime, setHoverTime] = useState(0)
  const [isAudioAvailable, setIsAudioAvailable] = useState(true)
  const { theme } = useTheme()

  useEffect(() => {
    const audio = audioRef.current
    if (!audio)
      return

    const handleError = () => {
      setIsAudioAvailable(false)
    }

    const setAudioData = () => {
      setDuration(audio.duration)
    }

    const setAudioTime = () => {
      setCurrentTime(audio.currentTime)
    }

    const handleProgress = () => {
      if (audio.buffered.length > 0)
        setBufferedTime(audio.buffered.end(audio.buffered.length - 1))
    }

    const handleEnded = () => {
      setIsPlaying(false)
    }

    audio.addEventListener('loadedmetadata', setAudioData)
    audio.addEventListener('timeupdate', setAudioTime)
    audio.addEventListener('progress', handleProgress)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    // Preload audio metadata
    audio.load()

    // Delayed generation of waveform data
    // eslint-disable-next-line ts/no-use-before-define
    const timer = setTimeout(() => generateWaveformData(src), 1000)

    return () => {
      audio.removeEventListener('loadedmetadata', setAudioData)
      audio.removeEventListener('timeupdate', setAudioTime)
      audio.removeEventListener('progress', handleProgress)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
      clearTimeout(timer)
    }
  }, [src])

  const generateWaveformData = async (audioSrc: string) => {
    if (!window.AudioContext && !(window as any).webkitAudioContext) {
      setIsAudioAvailable(false)
      Toast.notify({
        type: 'error',
        message: 'Web Audio API is not supported in this browser',
      })
      return null
    }

    const url = new URL(src)
    const isHttp = url.protocol === 'http:' || url.protocol === 'https:'
    if (!isHttp) {
      setIsAudioAvailable(false)
      return null
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    const samples = 70

    try {
      const response = await fetch(audioSrc, { mode: 'cors' })
      if (!response || !response.ok) {
        setIsAudioAvailable(false)
        return null
      }

      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      const channelData = audioBuffer.getChannelData(0)
      const blockSize = Math.floor(channelData.length / samples)
      const waveformData: number[] = []

      for (let i = 0; i < samples; i++) {
        let sum = 0
        for (let j = 0; j < blockSize; j++)
          sum += Math.abs(channelData[i * blockSize + j])

        // Apply nonlinear scaling to enhance small amplitudes
        waveformData.push((sum / blockSize) * 5)
      }

      // Normalized waveform data
      const maxAmplitude = Math.max(...waveformData)
      const normalizedWaveform = waveformData.map(amp => amp / maxAmplitude)

      setWaveformData(normalizedWaveform)
      setIsAudioAvailable(true)
    }
    catch (error) {
      const waveform: number[] = []
      let prevValue = Math.random()

      for (let i = 0; i < samples; i++) {
        const targetValue = Math.random()
        const interpolatedValue = prevValue + (targetValue - prevValue) * 0.3
        waveform.push(interpolatedValue)
        prevValue = interpolatedValue
      }

      const maxAmplitude = Math.max(...waveform)
      const randomWaveform = waveform.map(amp => amp / maxAmplitude)

      setWaveformData(randomWaveform)
      setIsAudioAvailable(true)
    }
    finally {
      await audioContext.close()
    }
  }

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (audio && isAudioAvailable) {
      if (isPlaying) {
        setHasStartedPlaying(false)
        audio.pause()
      }
      else {
        setHasStartedPlaying(true)
        audio.play().catch(error => console.error('Error playing audio:', error))
      }

      setIsPlaying(!isPlaying)
    }
    else {
      Toast.notify({
        type: 'error',
        message: 'Audio element not found',
      })
      setIsAudioAvailable(false)
    }
  }, [isAudioAvailable, isPlaying])

  const handleCanvasInteraction = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()

    const getClientX = (event: React.MouseEvent | React.TouchEvent): number => {
      if ('touches' in event)
        return event.touches[0].clientX
      return event.clientX
    }

    const updateProgress = (clientX: number) => {
      const canvas = canvasRef.current
      const audio = audioRef.current
      if (!canvas || !audio)
        return

      const rect = canvas.getBoundingClientRect()
      const percent = Math.min(Math.max(0, clientX - rect.left), rect.width) / rect.width
      const newTime = percent * duration

      // Removes the buffer check, allowing drag to any location
      audio.currentTime = newTime
      setCurrentTime(newTime)

      if (!isPlaying) {
        setIsPlaying(true)
        audio.play().catch((error) => {
          Toast.notify({
            type: 'error',
            message: `Error playing audio: ${error}`,
          })
          setIsPlaying(false)
        })
      }
    }

    updateProgress(getClientX(e))
  }, [duration, isPlaying])

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas)
      return

    const ctx = canvas.getContext('2d')
    if (!ctx)
      return

    const width = canvas.width
    const height = canvas.height
    const data = waveformData

    ctx.clearRect(0, 0, width, height)

    const barWidth = width / data.length
    const playedWidth = (currentTime / duration) * width
    const cornerRadius = 2

    // Draw waveform bars
    data.forEach((value, index) => {
      let color

      if (index * barWidth <= playedWidth)
        color = theme === Theme.light ? '#296DFF' : '#84ABFF'
      else if ((index * barWidth / width) * duration <= hoverTime)
        color = theme === Theme.light ? 'rgba(21,90,239,.40)' : 'rgba(200, 206, 218, 0.28)'
      else
        color = theme === Theme.light ? 'rgba(21,90,239,.20)' : 'rgba(200, 206, 218, 0.14)'

      const barHeight = value * height
      const rectX = index * barWidth
      const rectY = (height - barHeight) / 2
      const rectWidth = barWidth * 0.5
      const rectHeight = barHeight

      ctx.lineWidth = 1
      ctx.fillStyle = color
      if (ctx.roundRect) {
        ctx.beginPath()
        ctx.roundRect(rectX, rectY, rectWidth, rectHeight, cornerRadius)
        ctx.fill()
      }
      else {
        ctx.fillRect(rectX, rectY, rectWidth, rectHeight)
      }
    })
  }, [currentTime, duration, hoverTime, theme, waveformData])

  useEffect(() => {
    drawWaveform()
  }, [drawWaveform, bufferedTime, hasStartedPlaying])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio)
      return

    const rect = canvas.getBoundingClientRect()
    const percent = Math.min(Math.max(0, e.clientX - rect.left), rect.width) / rect.width
    const time = percent * duration

    // Check if the hovered position is within a buffered range before updating hoverTime
    for (let i = 0; i < audio.buffered.length; i++) {
      if (time >= audio.buffered.start(i) && time <= audio.buffered.end(i)) {
        setHoverTime(time)
        break
      }
    }
  }, [duration])

  return (
    <div className='flex items-end gap-2 h-9 min-w-[240px] max-w-[420px] p-2 bg-components-chat-input-audio-bg-alt backdrop-blur-sm rounded-[10px] border border-components-panel-border-subtle shadow-xs'>
      <audio ref={audioRef} src={src} preload="auto"/>
      <button className='shrink-0 inline-flex items-center justify-center border-none text-text-accent hover:text-text-accent-secondary transition-all cursor-pointer disabled:text-components-button-primary-bg-disabled' onClick={togglePlay} disabled={!isAudioAvailable}>
        {isPlaying
          ? (
            <RiPauseCircleFill className='w-5 h-5' />
          )
          : (
            <RiPlayLargeFill className='w-5 h-5' />
          )}
      </button>
      <div className={cn(isAudioAvailable && 'grow')} hidden={!isAudioAvailable}>
        <div className='h-8 flex items-center justify-center'>
          <canvas
            ref={canvasRef}
            className='relative grow h-6 w-full flex items-center justify-center cursor-pointer'
            onClick={handleCanvasInteraction}
            onMouseMove={handleMouseMove}
            onMouseDown={handleCanvasInteraction}
          />
          <div className='inline-flex items-center justify-center min-w-[50px] text-text-accent-secondary system-xs-medium'>
            <span className='px-0.5 py-1 rounded-[10px]'>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
      <div className='absolute top-0 left-0 w-full h-full flex items-center justify-center text-text-quaternary' hidden={isAudioAvailable}>{t('common.operation.audioSourceUnavailable')}</div>
    </div>
  )
}

export default AudioPlayer
