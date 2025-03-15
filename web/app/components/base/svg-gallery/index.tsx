'use client'

import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { SVG } from '@svgdotjs/svg.js'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'

type SVGRendererProps = {
  content: string
}

const SVGRenderer: FC<SVGRendererProps> = ({ content }) => {
  const svgRef = useRef<HTMLDivElement>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [isValidSVG, setIsValidSVG] = useState(false)
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  })

  const svgToDataURL = (svgElement: Element): string => {
    const svgString = new XMLSerializer().serializeToString(svgElement)
    const base64String = btoa(svgString)
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
        
        // Check if the SVG content is valid
        const parser = new DOMParser()
        const svgDoc = parser.parseFromString(content, 'image/svg+xml')
        const svgElement = svgDoc.documentElement
        
        // Check for parsing errors
        const parserError = svgDoc.querySelector('parsererror')
        if (parserError || !(svgElement instanceof SVGElement)) {
          throw new Error('Invalid SVG content')
        }
        
        // If we get here, the SVG is valid
        const draw = SVG().addTo(svgRef.current)
        
        const originalWidth = parseInt(svgElement.getAttribute('width') || '400', 10)
        const originalHeight = parseInt(svgElement.getAttribute('height') || '600', 10)
        draw.viewbox(0, 0, originalWidth, originalHeight)

        svgRef.current.style.width = `${Math.min(originalWidth, 298)}px`

        const rootElement = draw.svg(content)

        rootElement.click(() => {
          setImagePreview(svgToDataURL(svgElement as Element))
        })
        
        setIsValidSVG(true)
      }
      catch (error) {
        // SVG is invalid or incomplete, show the raw content
        setIsValidSVG(false)
        if (svgRef.current) {
          svgRef.current.innerHTML = ''
          const pre = document.createElement('pre')
          pre.style.padding = '1rem'
          pre.style.whiteSpace = 'pre-wrap'
          pre.style.wordBreak = 'break-word'
          pre.style.maxHeight = '400px'
          pre.style.overflow = 'auto'
          pre.textContent = content
          svgRef.current.appendChild(pre)
        }
      }
    }
  }, [content, windowSize])

  return (
    <React.Fragment>
      <div ref={svgRef} style={{
        maxHeight: '80vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: isValidSVG ? 'center' : 'flex-start',
        cursor: isValidSVG ? 'pointer' : 'text',
        wordBreak: 'break-word',
        whiteSpace: 'normal',
        margin: '0 auto',
        width: '100%',
      }} />
      {imagePreview && (<ImagePreview url={imagePreview} title='Preview' onCancel={() => setImagePreview('')} />)}
    </React.Fragment>
  )
}

export default SVGRenderer
