import React, { useCallback, useEffect, useRef, useState } from 'react'
import { t } from 'i18next'
import styles from './AudioPlayer.module.css'
import Toast from '@/app/components/base/toast'

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
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
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
        color = '#296DFF'
      else if ((index * barWidth / width) * duration <= hoverTime)
        color = 'rgba(21,90,239,.40)'
      else
        color = 'rgba(21,90,239,.20)'

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
  }, [currentTime, duration, hoverTime, waveformData])

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
    <div className={styles.audioPlayer}>
      <audio ref={audioRef} src={src} preload="auto"/>
      <button className={styles.playButton} onClick={togglePlay} disabled={!isAudioAvailable}>
        {isPlaying
          ? (
            <svg viewBox="0 0 24 24" width="16" height="16">
              <rect x="7" y="6" width="3" height="12" rx="1.5" ry="1.5"/>
              <rect x="15" y="6" width="3" height="12" rx="1.5" ry="1.5"/>
            </svg>
          )
          : (
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M8 5v14l11-7z" fill="currentColor"/>
            </svg>
          )}
      </button>
      <div className={isAudioAvailable ? styles.audioControls : styles.audioControls_disabled} hidden={!isAudioAvailable}>
        <div className={styles.progressBarContainer}>
          <canvas
            ref={canvasRef}
            className={styles.waveform}
            onClick={handleCanvasInteraction}
            onMouseMove={handleMouseMove}
            onMouseDown={handleCanvasInteraction}
          />
          {/* <div className={styles.currentTime} style={{ left: `${(currentTime / duration) * 81}%`, bottom: '29px' }}>
            {formatTime(currentTime)}
          </div> */}
          <div className={styles.timeDisplay}>
            <span className={styles.duration}>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
      <div className={styles.source_unavailable} hidden={isAudioAvailable}>{t('common.operation.audioSourceUnavailable')}</div>
    </div>
  )
}

export default AudioPlayer
