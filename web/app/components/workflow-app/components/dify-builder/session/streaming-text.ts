export type ScheduledFrame = {
  animationFrameId: number | null
  timeoutId: ReturnType<typeof globalThis.setTimeout>
}

const FRAME_FALLBACK_MS = 100

export const STREAM_FIRST_FRAME_CHARACTERS = 24
export const STREAM_CHARACTERS_PER_UPDATE = 120
export const STREAM_UPDATE_INTERVAL_MS = 80
export const STREAM_MAX_PENDING_CHARACTERS = 2048

export const scheduleFrame = (callback: () => void): ScheduledFrame => {
  if (
    typeof globalThis.requestAnimationFrame === 'function' &&
    (typeof document === 'undefined' || document.visibilityState !== 'hidden')
  ) {
    let animationFrameId = 0
    const timeoutId = globalThis.setTimeout(() => {
      globalThis.cancelAnimationFrame?.(animationFrameId)
      callback()
    }, FRAME_FALLBACK_MS)
    animationFrameId = globalThis.requestAnimationFrame(() => {
      globalThis.clearTimeout(timeoutId)
      callback()
    })
    return { animationFrameId, timeoutId }
  }

  return {
    animationFrameId: null,
    timeoutId: globalThis.setTimeout(callback, 16),
  }
}

export const cancelFrame = (frame: ScheduledFrame) => {
  globalThis.clearTimeout(frame.timeoutId)
  if (frame.animationFrameId !== null) globalThis.cancelAnimationFrame?.(frame.animationFrameId)
}
