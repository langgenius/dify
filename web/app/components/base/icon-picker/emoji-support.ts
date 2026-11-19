// Adapted from Frimousse 0.3.0 (MIT). See emoji-support.LICENSE.
const EMOJI_FONT_FAMILY = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

const CANVAS_SIZE = 2

let context: CanvasRenderingContext2D | null = null

export function isEmojiSupported(emoji: string): boolean {
  try {
    context ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  } catch {}

  // Keep the catalog available when canvas rendering cannot be probed.
  if (!context) {
    return true
  }

  // Schedule to dispose of the context
  queueMicrotask(() => {
    if (context) {
      context = null
    }
  })

  context.canvas.width = CANVAS_SIZE
  context.canvas.height = CANVAS_SIZE
  context.font = `2px ${EMOJI_FONT_FAMILY}`
  context.textBaseline = 'middle'

  // Unsupported ZWJ sequence emojis show up as separate emojis
  if (context.measureText(emoji).width >= CANVAS_SIZE * 2) {
    return false
  }

  context.fillStyle = '#00f'
  context.fillText(emoji, 0, 0)

  const blue = context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data

  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

  context.fillStyle = '#f00'
  context.fillText(emoji, 0, 0)

  const red = context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data

  // Emojis have an immutable color so they should look the same regardless of the text color
  for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE * 4; i += 4) {
    if (
      blue[i] !== red[i] || //         R
      blue[i + 1] !== red[i + 1] || // G
      blue[i + 2] !== red[i + 2] //    B
    ) {
      return false
    }
  }

  return true
}
