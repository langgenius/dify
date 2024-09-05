import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './VideoPlayer.module.css'

type VideoPlayerProps = {
  src: string
}

const PlayIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 5V19L19 12L8 5Z" fill="currentColor"/>
  </svg>
)

const PauseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 19H10V5H6V19ZM14 5V19H18V5H14Z" fill="currentColor"/>
  </svg>
)

const MuteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 9V15H7L12 20V4L7 9H3ZM16.5 12C16.5 10.23 15.48 8.71 14 7.97V16.02C15.48 15.29 16.5 13.77 16.5 12ZM14 3.23V5.29C16.89 6.15 19 8.83 19 12C19 15.17 16.89 17.85 14 18.71V20.77C18.01 19.86 21 16.28 21 12C21 7.72 18.01 4.14 14 3.23Z" fill="currentColor"/>
  </svg>
)

const UnmuteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.34 2.93L2.93 4.34L7.29 8.7L7 9H3V15H7L12 20V13.41L16.18 17.59C15.69 17.96 15.16 18.27 14.58 18.5V20.58C15.94 20.22 17.15 19.56 18.13 18.67L19.66 20.2L21.07 18.79L4.34 2.93ZM10 15.17L7.83 13H5V11H7.83L10 8.83V15.17ZM19 12C19 12.82 18.85 13.61 18.59 14.34L20.12 15.87C20.68 14.7 21 13.39 21 12C21 7.72 18.01 4.14 14 3.23V5.29C16.89 6.15 19 8.83 19 12ZM12 4L10.12 5.88L12 7.76V4ZM16.5 12C16.5 10.23 15.48 8.71 14 7.97V10.18L16.45 12.63C16.48 12.43 16.5 12.22 16.5 12Z" fill="currentColor"/>
  </svg>
)

const FullscreenIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7 14H5V19H10V17H7V14ZM5 10H7V7H10V5H5V10ZM17 17H14V19H19V14H17V17ZM14 5V7H17V10H19V5H14Z" fill="currentColor"/>
  </svg>
)

const VideoPlayer: React.FC<VideoPlayerProps> = ({ src }) => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [isControlsVisible, setIsControlsVisible] = useState(true)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const volumeRef = useRef<HTMLDivElement>(null)
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [isSmallSize, setIsSmallSize] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video)
      return

    const setVideoData = () => {
      setDuration(video.duration)
      setVolume(video.volume)
    }

    const setVideoTime = () => {
      setCurrentTime(video.currentTime)
    }

    const handleEnded = () => {
      setIsPlaying(false)
    }

    video.addEventListener('loadedmetadata', setVideoData)
    video.addEventListener('timeupdate', setVideoTime)
    video.addEventListener('ended', handleEnded)

    return () => {
      video.removeEventListener('loadedmetadata', setVideoData)
      video.removeEventListener('timeupdate', setVideoTime)
      video.removeEventListener('ended', handleEnded)
    }
  }, [src])

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current)
        clearTimeout(controlsTimeoutRef.current)
    }
  }, [])

  const showControls = useCallback(() => {
    setIsControlsVisible(true)
    if (controlsTimeoutRef.current)
      clearTimeout(controlsTimeoutRef.current)

    controlsTimeoutRef.current = setTimeout(() => setIsControlsVisible(false), 3000)
  }, [])

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current
    if (video) {
      if (isPlaying)
        video.pause()
      else video.play().catch(error => console.error('Error playing video:', error))
      setIsPlaying(!isPlaying)
    }
  }, [isPlaying])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (video) {
      const newMutedState = !video.muted
      video.muted = newMutedState
      setIsMuted(newMutedState)
      setVolume(newMutedState ? 0 : (video.volume > 0 ? video.volume : 1))
      video.volume = newMutedState ? 0 : (video.volume > 0 ? video.volume : 1)
    }
  }, [])

  const toggleFullscreen = useCallback(() => {
    const video = videoRef.current
    if (video) {
      if (document.fullscreenElement)
        document.exitFullscreen()
      else video.requestFullscreen()
    }
  }, [])

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  const updateVideoProgress = useCallback((clientX: number) => {
    const progressBar = progressRef.current
    const video = videoRef.current
    if (progressBar && video) {
      const rect = progressBar.getBoundingClientRect()
      const pos = (clientX - rect.left) / rect.width
      const newTime = pos * video.duration
      if (newTime >= 0 && newTime <= video.duration) {
        setHoverTime(newTime)
        if (isDragging)
          video.currentTime = newTime
      }
    }
  }, [isDragging])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    updateVideoProgress(e.clientX)
  }, [updateVideoProgress])

  const handleMouseLeave = useCallback(() => {
    if (!isDragging)
      setHoverTime(null)
  }, [isDragging])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
    updateVideoProgress(e.clientX)
  }, [updateVideoProgress])

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragging)
        updateVideoProgress(e.clientX)
    }

    const handleGlobalMouseUp = () => {
      setIsDragging(false)
      setHoverTime(null)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove)
      document.addEventListener('mouseup', handleGlobalMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove)
      document.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [isDragging, updateVideoProgress])

  const checkSize = useCallback(() => {
    if (containerRef.current)
      setIsSmallSize(containerRef.current.offsetWidth < 400)
  }, [])

  useEffect(() => {
    checkSize()
    window.addEventListener('resize', checkSize)
    return () => window.removeEventListener('resize', checkSize)
  }, [checkSize])

  const handleVolumeChange = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const volumeBar = volumeRef.current
    const video = videoRef.current
    if (volumeBar && video) {
      const rect = volumeBar.getBoundingClientRect()
      const newVolume = (e.clientX - rect.left) / rect.width
      const clampedVolume = Math.max(0, Math.min(1, newVolume))
      video.volume = clampedVolume
      setVolume(clampedVolume)
      setIsMuted(clampedVolume === 0)
    }
  }, [])

  return (
    <div ref={containerRef} className={styles.videoPlayer} onMouseMove={showControls} onMouseEnter={showControls}>
      <video ref={videoRef} src={src} className={styles.video} />
      <div className={`${styles.controls} ${isControlsVisible ? styles.visible : styles.hidden} ${isSmallSize ? styles.smallSize : ''}`}>
        <div className={styles.overlay}>
          <div className={styles.progressBarContainer}>
            <div
              ref={progressRef}
              className={styles.progressBar}
              onClick={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onMouseDown={handleMouseDown}
            >
              <div className={styles.progress} style={{ width: `${(currentTime / duration) * 100}%` }} />
              {hoverTime !== null && (
                <div
                  className={styles.hoverTimeIndicator}
                  style={{ left: `${(hoverTime / duration) * 100}%` }}
                >
                  {formatTime(hoverTime)}
                </div>
              )}
            </div>
          </div>
          <div className={styles.controlsContent}>
            <div className={styles.leftControls}>
              <button className={styles.playPauseButton} onClick={togglePlayPause}>
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              {!isSmallSize && (<span className={styles.time}>{formatTime(currentTime)} / {formatTime(duration)}</span>)}
            </div>
            <div className={styles.rightControls}>
              <button className={styles.muteButton} onClick={toggleMute}>
                {isMuted ? <UnmuteIcon /> : <MuteIcon />}
              </button>
              {!isSmallSize && (
                <div className={styles.volumeControl}>
                  <div
                    ref={volumeRef}
                    className={styles.volumeSlider}
                    onClick={handleVolumeChange}
                    onMouseDown={(e) => {
                      handleVolumeChange(e)
                      const handleMouseMove = (e: MouseEvent) => handleVolumeChange(e as unknown as React.MouseEvent<HTMLDivElement>)
                      const handleMouseUp = () => {
                        document.removeEventListener('mousemove', handleMouseMove)
                        document.removeEventListener('mouseup', handleMouseUp)
                      }
                      document.addEventListener('mousemove', handleMouseMove)
                      document.addEventListener('mouseup', handleMouseUp)
                    }}
                  >
                    <div className={styles.volumeLevel} style={{ width: `${volume * 100}%` }} />
                  </div>
                </div>
              )}
              <button className={styles.fullscreenButton} onClick={toggleFullscreen}>
                <FullscreenIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default VideoPlayer
