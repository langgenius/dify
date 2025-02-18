import type { FC } from 'react'
import { useCallback, useEffect, useRef } from 'react'

type GridMaskProps = {
  children: React.ReactNode
  wrapperClassName?: string
  canvasClassName?: string
  gradientClassName?: string
}
const GridMask: FC<GridMaskProps> = ({
  children,
  wrapperClassName,
  canvasClassName,
  gradientClassName,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const initCanvas = () => {
    const dpr = window.devicePixelRatio || 1

    if (canvasRef.current) {
      const { width: cssWidth, height: cssHeight } = canvasRef.current?.getBoundingClientRect()

      canvasRef.current.width = dpr * cssWidth
      canvasRef.current.height = dpr * cssHeight

      const ctx = canvasRef.current.getContext('2d')
      if (ctx) {
        ctx.scale(dpr, dpr)
        ctx.strokeStyle = '#D1E0FF'
        ctxRef.current = ctx
      }
    }
  }

  const drawRecord = useCallback(() => {
    const canvas = canvasRef.current!
    const ctx = ctxRef.current!
    const rowNumber = Number.parseInt(`${canvas.width / 24}`)
    const colNumber = Number.parseInt(`${canvas.height / 24}`)

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.beginPath()
    for (let i = 0; i < rowNumber; i++) {
      for (let j = 0; j < colNumber; j++) {
        const x = i * 24
        const y = j * 24
        if (j === 0) {
          ctx.moveTo(x, y + 2)
          ctx.arc(x + 2, y + 2, 2, Math.PI, Math.PI * 1.5)
          ctx.lineTo(x + 22, y)
          ctx.arc(x + 22, y + 2, 2, Math.PI * 1.5, Math.PI * 2)
          ctx.lineTo(x + 24, y + 22)
          ctx.arc(x + 22, y + 22, 2, 0, Math.PI * 0.5)
          ctx.lineTo(x + 2, y + 24)
          ctx.arc(x + 2, y + 22, 2, Math.PI * 0.5, Math.PI)
        }
        else {
          ctx.moveTo(x + 2, y)
          ctx.arc(x + 2, y + 2, 2, Math.PI * 1.5, Math.PI, true)
          ctx.lineTo(x, y + 22)
          ctx.arc(x + 2, y + 22, 2, Math.PI, Math.PI * 0.5, true)
          ctx.lineTo(x + 22, y + 24)
          ctx.arc(x + 22, y + 22, 2, Math.PI * 0.5, 0, true)
          ctx.lineTo(x + 24, y + 2)
          ctx.arc(x + 22, y + 2, 2, 0, Math.PI * 1.5, true)
        }
      }
    }
    ctx.stroke()
    ctx.closePath()
  }, [])

  const handleStartDraw = () => {
    if (canvasRef.current && ctxRef.current)
      drawRecord()
  }

  useEffect(() => {
    initCanvas()
    handleStartDraw()
  }, [])

  return (
    <div className={`bg-components-panel-bg relative ${wrapperClassName}`}>
      <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full ${canvasClassName}`} />
      <div className={`from-background-body to-background-gradient-mask-transparent absolute z-[1] h-full w-full rounded-lg bg-gradient-to-b ${gradientClassName}`} />
      <div className='relative z-[2]'>{children}</div>
    </div>
  )
}

export default GridMask
