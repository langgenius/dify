'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Infographic } from '@antv/infographic'
import { useTranslation } from 'react-i18next'
import { ClipboardDocumentIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import Toast from '@/app/components/base/toast'

export type InfographicProps = {
  syntax: string
  className?: string
  height?: number
  width?: number | string
  onError?: (error: Error) => void
}

const InfographicViewer: React.FC<InfographicProps> = ({
  syntax,
  className = '',
  height = 600,
  width = '100%',
  onError,
}) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const infographicRef = useRef<Infographic | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current)
      return

    try {
      setIsLoading(true)
      setError(null)

      // Clear previous instance
      if (infographicRef.current) {
        infographicRef.current.destroy()
        infographicRef.current = null
      }

      // Create new infographic instance
      const infographic = new Infographic({
        container: containerRef.current,
        width,
        height,
        editable: false,
      })

      // Render the infographic with the syntax
      infographic.render(syntax)
      infographicRef.current = infographic
      setIsLoading(false)
    }
    catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to render infographic'
      setError(errorMessage)
      setIsLoading(false)
      onError?.(err instanceof Error ? err : new Error(errorMessage))
    }

    return () => {
      if (infographicRef.current) {
        infographicRef.current.destroy()
        infographicRef.current = null
      }
    }
  }, [syntax, height, width, onError])

  const handleCopyImage = async () => {
    try {
      if (!infographicRef.current)
        return

      // Export to SVG and convert to blob
      const svgString = await infographicRef.current.toSVG()
      const blob = new Blob([svgString], { type: 'image/svg+xml' })
      
      // For clipboard, we need to convert SVG to PNG
      const img = new Image()
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      img.onload = () => {
        canvas.width = img.width
        canvas.height = img.height
        ctx?.drawImage(img, 0, 0)
        
        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            const item = new ClipboardItem({ 'image/png': pngBlob })
            navigator.clipboard.write([item]).then(() => {
              Toast.notify({
                type: 'success',
                message: t('common.actionMsg.copySuccessfully'),
              })
            })
          }
        })
      }
      
      img.src = URL.createObjectURL(blob)
    }
    catch (err) {
      console.error('Failed to copy infographic image:', err)
      Toast.notify({
        type: 'error',
        message: t('common.actionMsg.copyFailed'),
      })
    }
  }

  const handleDownloadImage = async () => {
    try {
      if (!infographicRef.current)
        return

      const svgString = await infographicRef.current.toSVG()
      const blob = new Blob([svgString], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = `infographic-${Date.now()}.svg`
      link.href = url
      link.click()
      URL.revokeObjectURL(url)

      Toast.notify({
        type: 'success',
        message: t('common.actionMsg.downloadSuccessfully'),
      })
    }
    catch (err) {
      console.error('Failed to download infographic image:', err)
      Toast.notify({
        type: 'error',
        message: t('common.actionMsg.downloadFailed'),
      })
    }
  }

  return (
    <div className={`relative ${className}`}>
      {/* Toolbar */}
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        <button
          onClick={handleCopyImage}
          disabled={isLoading || !!error}
          className="p-2 bg-white rounded-lg shadow-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={t('common.operation.copy')}
        >
          <ClipboardDocumentIcon className="w-4 h-4 text-gray-700" />
        </button>
        <button
          onClick={handleDownloadImage}
          disabled={isLoading || !!error}
          className="p-2 bg-white rounded-lg shadow-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={t('common.operation.download')}
        >
          <ArrowDownTrayIcon className="w-4 h-4 text-gray-700" />
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 rounded-lg">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-600">Rendering infographic...</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-50 rounded-lg">
          <div className="text-center p-4">
            <p className="text-red-600 font-medium mb-2">Error</p>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        </div>
      )}

      {/* Infographic Container */}
      <div
        ref={containerRef}
        className="w-full rounded-lg overflow-hidden bg-white"
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      />
    </div>
  )
}

export default InfographicViewer
