import type { Zoom } from 'pele'
import DOMPurify from 'dompurify'
import { enableZoom, forgetTextWidths, parse, render } from 'pele'
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { serializeDiagram } from './export-diagram'

type DiagramOptions = {
  source: string
  mode: 'inline' | 'preview'
  onRendered?: (source: string) => void
}

export function useDiagram({ source, mode, onRendered }: DiagramOptions) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<Zoom | null>(null)
  const exportRef = useRef<SVGSVGElement | null>(null)
  const id = useId()
  const [result, setResult] = useState({ ready: false, error: '' })
  const reportSource = useEffectEvent((renderedSource: string) => onRendered?.(renderedSource))
  useEffect(() => {
    const container = canvasRef.current
    const stage = stageRef.current
    if (!container || !stage) return
    let frame = 0
    let width = -1
    let height = -1
    let disposed = false
    let model: ReturnType<typeof parse> | undefined

    const draw = () => {
      const availableWidth = stage.clientWidth
      if (!availableWidth) return
      width = availableWidth
      height = stage.clientHeight
      try {
        model ??= parse(source, { limit: 50_000, maxEdges: 500 })
        const result = render(model, {
          idPrefix: `diagram-${id.replaceAll(':', '')}`,
          fontFamily: getComputedStyle(container).fontFamily,
          maxWidth: availableWidth,
          autoDirection: false,
          responsive: true,
          links: false,
          images: false,
          outputLimit: 4_000_000,
        })
        const fragment = DOMPurify.sanitize(result.svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          RETURN_DOM_FRAGMENT: true,
        })
        const svg = fragment.querySelector('svg')
        if (!svg) throw new Error('The diagram has no SVG output')
        const fit = Math.min(
          availableWidth / result.width,
          mode === 'preview' ? height / result.height : 1,
        )
        const original = mode === 'preview' ? (svg.cloneNode(true) as SVGSVGElement) : null
        const fittedWidth = mode === 'preview' ? availableWidth : result.width * fit
        const fittedHeight = mode === 'preview' ? height : result.height * fit
        if (mode === 'preview') {
          // Give Pele a full-stage viewBox, including the centered drawing's empty margins.
          // Its fit/zoom math then has one consistent aspect ratio from the first frame.
          const frameWidth = fittedWidth / fit
          const frameHeight = fittedHeight / fit
          const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'g')
          drawing.setAttribute(
            'transform',
            `translate(${(frameWidth - result.width) / 2} ${(frameHeight - result.height) / 2})`,
          )
          drawing.append(...svg.childNodes)
          svg.append(drawing)
          svg.setAttribute('width', String(frameWidth))
          svg.setAttribute('height', String(frameHeight))
          svg.setAttribute('viewBox', `0 0 ${frameWidth} ${frameHeight}`)
        }
        svg.style.width = `${fittedWidth}px`
        svg.style.height = `${fittedHeight}px`
        const restoreFocus = container.contains(document.activeElement)
        zoomRef.current?.destroy()
        container.style.width = `${fittedWidth}px`
        container.style.height = `${fittedHeight}px`
        container.replaceChildren(fragment)
        exportRef.current = original
        zoomRef.current = enableZoom(container, {
          controls: false,
          always: true,
          maxScale: Math.max(3, fit * 3),
        })
        if (restoreFocus) container.querySelector('svg')?.focus({ preventScroll: true })
        setResult({ ready: true, error: '' })
        reportSource(source)
      } catch (failure) {
        setResult((previous) => ({
          ...previous,
          error: failure instanceof Error ? failure.message : String(failure),
        }))
      }
    }
    const schedule = () => {
      if (disposed) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(draw)
    }
    // Inline height follows the drawing; only the fixed preview stage observes both dimensions.
    const observer = new ResizeObserver(() => {
      if (stage.clientWidth !== width || (mode === 'preview' && stage.clientHeight !== height))
        schedule()
    })
    observer.observe(stage)
    schedule()
    const fontsLoaded = () => {
      if (disposed) return
      forgetTextWidths()
      schedule()
    }
    if (document.fonts?.status === 'loading') void document.fonts.ready.then(fontsLoaded)
    document.fonts?.addEventListener('loadingdone', fontsLoaded)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.fonts?.removeEventListener('loadingdone', fontsLoaded)
    }
  }, [source, id, mode])

  useEffect(
    () => () => {
      zoomRef.current?.destroy()
      zoomRef.current = null
    },
    [],
  )

  return {
    stageRef,
    canvasRef,
    ...result,
    zoomBy: (factor: number) => zoomRef.current?.zoomBy(factor),
    reset: () => zoomRef.current?.reset(),
    exportSvg: () => {
      const svg = exportRef.current
      const theme = stageRef.current
      return svg && theme ? serializeDiagram(svg, theme) : null
    },
  }
}
