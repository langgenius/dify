import { useEffect, useRef, useState } from 'react'
import { SVG } from '@svgdotjs/svg.js'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'

export const SVGRenderer = ({ content }: { content: string }) => {
  const svgRef = useRef<HTMLDivElement>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  })

  const svgToDataURL = (svgElement: Element): string => {
    const svgString = new XMLSerializer().serializeToString(svgElement)
    const base64String = Buffer.from(svgString).toString('base64')
    return `data:image/svg+xml;base64,${base64String}`
  }

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight })
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (svgRef.current) {
      try {
        svgRef.current.innerHTML = ''
        const draw = SVG().addTo(svgRef.current).size('100%', '100%')

        const parser = new DOMParser()
        const svgDoc = parser.parseFromString(content, 'image/svg+xml')
        const svgElement = svgDoc.documentElement

        if (!(svgElement instanceof SVGElement))
          throw new Error('Invalid SVG content')

        const originalWidth = parseInt(svgElement.getAttribute('width') || '400', 10)
        const originalHeight = parseInt(svgElement.getAttribute('height') || '600', 10)
        const scale = Math.min(windowSize.width / originalWidth, windowSize.height / originalHeight, 1)
        const scaledWidth = originalWidth * scale
        const scaledHeight = originalHeight * scale
        draw.size(scaledWidth, scaledHeight)

        const rootElement = draw.svg(content)
        rootElement.scale(scale)

        rootElement.click(() => {
          setImagePreview(svgToDataURL(svgElement as Element))
        })
      }
      catch (error) {
        if (svgRef.current)
          svgRef.current.innerHTML = 'Error rendering SVG. Wait for the image content to complete.'
      }
    }
  }, [content, windowSize])

  return (
    <>
      <div ref={svgRef} style={{
        width: '100%',
        height: '100%',
        minHeight: '300px',
        maxHeight: '80vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        cursor: 'pointer',
      }} />
      {imagePreview && (<ImagePreview url={imagePreview} title='Preview' onCancel={() => setImagePreview('')} />)}
    </>
  )
}

export default SVGRenderer
