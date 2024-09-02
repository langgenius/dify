import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './AudioPlayer.module.css'

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

  useEffect(() => {
    const audio = audioRef.current
    if (!audio)
      return

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
      clearTimeout(timer)
    }
  }, [src])

  const generateWaveformData = async (audioSrc: string) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    const response = await fetch(audioSrc)
    const arrayBuffer = await response.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

    const channelData = audioBuffer.getChannelData(0)

    // Calculate the number of samples we want to take from the channel data.
    const samples = Math.min(90, channelData.length)

    // Calculate the size of each sample block.
    const blockSize = Math.floor(channelData.length / samples)

    // Create an array to hold the waveform data.
    const waveformData: number[] = []

    for (let i = 0; i < samples; i++) {
      const blockStart = blockSize * i
      let sum = 0

      for (let j = blockStart; j < blockStart + blockSize; j++)
        sum += Math.abs(channelData[j])

      // Multiply the average by a constant factor to increase its size.
      waveformData.push((sum / blockSize) * 4) // Increase this factor as needed
    }

    setWaveformData(waveformData)
  }

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
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
      console.log('Audio element not found')
    }
  }, [isPlaying])

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
          console.error('Error playing audio:', error)
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

    ctx.lineWidth = 1

    // Draw waveform bars
    data.forEach((value, index) => {
      let color

      if (index * barWidth <= playedWidth)
        color = '#296DFF'
      else if ((index * barWidth / width) * duration <= hoverTime)
        color = 'rgba(21,90,239,.40)'
      else
        color = 'rgba(21,90,239,.20)'

      ctx.strokeStyle = color
      const x = index * barWidth
      const barHeight = value * height

      ctx.beginPath()
      ctx.moveTo(x, height / 2)
      ctx.lineTo(x, (height - barHeight) / 2)
      ctx.moveTo(x, height / 2)
      ctx.lineTo(x, (height + barHeight) / 2)
      ctx.stroke()
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
      <audio ref={audioRef} src={src} preload="auto" />
      <button className={styles.playButton} onClick={togglePlay}>
        {isPlaying
          ? (
            <svg viewBox="0 0 24 24" width="15" height="15">
              <rect x="6" y="4" width="3" height="15" />
              <rect x="14" y="4" width="3" height="15" />
            </svg>
          )
          : (
            <svg viewBox="0 0 24 24" width="15" height="15">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          )}
      </button>
      <div className={styles.audioControls}>
        <div className={styles.progressBarContainer}>
          <canvas
            ref={canvasRef}
            className={styles.waveform}
            onClick={handleCanvasInteraction}
            onMouseMove={handleMouseMove}
            onMouseDown={handleCanvasInteraction}
          />
          <div className={styles.currentTime} style={{ left: `${(currentTime / duration) * 88}%`, bottom: '28px' }}>
            {formatTime(currentTime)}
          </div>
          <div className={styles.timeDisplay}>
            <span className={styles.duration}>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AudioPlayer
