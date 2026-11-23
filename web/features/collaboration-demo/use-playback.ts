import { useEffect, useState } from 'react'

export function usePlayback(duration: number) {
  const [playback, setPlayback] = useState({ seconds: 0, playing: true })

  useEffect(() => {
    if (!playback.playing) return

    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const delta = Math.min(0.1, (now - last) / 1000)
      last = now
      setPlayback((current) => {
        const seconds = Math.min(duration, current.seconds + delta)
        return { seconds, playing: seconds < duration }
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [duration, playback.playing])

  return {
    seconds: playback.seconds,
    playing: playback.playing,
    finished: playback.seconds >= duration,
    play: () => setPlayback((current) => ({ ...current, playing: current.seconds < duration })),
    pause: () => setPlayback((current) => ({ ...current, playing: false })),
    skip: () => setPlayback({ seconds: duration, playing: false }),
    restart: () => setPlayback({ seconds: 0, playing: true }),
  }
}
