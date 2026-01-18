'use client'

import { Infographic } from '@antv/infographic'
import { ArrowDownTrayIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
  const containerRef = React.useRef<HTMLDivElement>(null)
  const infographicRef = React.useRef<Infographic | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!containerRef.current)
      return

    try {
      // Clear previous instance
      if (infographicRef.current) {
        infographicRef.current.destroy()
        infographicRef.current = null
      }

      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect -- Infographic.render() is synchronous, no async state needed
      setError(null)

      // Create new infographic instance
      const infographic = new Infographic({
        container: containerRef.current,
        width,
        height,
        editable: false,
      })

      // Render the infographic with the syntax (synchronous)
      infographic.render(syntax)
      infographicRef.current = infographic
    }
    catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to render infographic'
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect -- Infographic.render() is synchronous, no async state needed
      setError(errorMessage)
      onError?.(err instanceof Error ? err : new Error(errorMessage))
    }

    return () => {
      if (infographicRef.current) {
        infographicRef.current.destroy()
        infographicRef.current = null
      }
    }
  }, [syntax, width, height, onError])

  const handleCopyImage = async () => {
    try {
      if (!containerRef.current)
        return

      // Get SVG element from container
      const svgElement = containerRef.current.querySelector('svg')
      if (!svgElement)
        return

      // Serialize SVG to string
      const svgString = new XMLSerializer().serializeToString(svgElement)
      const blob = new Blob([svgString], { type: 'image/svg+xml' })

      // For clipboard, we need to convert SVG to PNG
      const img = new Image()
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')

      img.onload = () => {
        canvas.width = img.width || svgElement.clientWidth
        canvas.height = img.height || svgElement.clientHeight
        ctx?.drawImage(img, 0, 0)

        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            const item = new ClipboardItem({ 'image/png': pngBlob })
            navigator.clipboard.write([item]).then(() => {
              Toast.notify({
                type: 'success',
                message: t('actionMsg.copySuccessfully', { ns: 'common' }),
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
        message: t('api.actionFailed', { ns: 'common' }),
      })
    }
  }

  const handleDownloadImage = async () => {
    try {
      if (!containerRef.current)
        return

      // Get SVG element from container
      const svgElement = containerRef.current.querySelector('svg')
      if (!svgElement)
        return

      // Serialize SVG to string
      const svgString = new XMLSerializer().serializeToString(svgElement)
      const blob = new Blob([svgString], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = `infographic-${Date.now()}.svg`
      link.href = url
      link.click()
      URL.revokeObjectURL(url)

      Toast.notify({
        type: 'success',
        message: t('operation.downloadSuccess', { ns: 'common' }),
      })
    }
    catch (err) {
      console.error('Failed to download infographic image:', err)
      Toast.notify({
        type: 'error',
        message: t('operation.downloadFailed', { ns: 'common' }),
      })
    }
  }

  return (
    <div className={`relative ${className}`}>
      {/* Toolbar */}
      <div className="absolute right-2 top-2 z-10 flex gap-2">
        <button
          onClick={handleCopyImage}
          disabled={!!error}
          className="rounded-lg bg-white p-2 shadow-md transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          title={t('operation.copy', { ns: 'common' })}
        >
          <ClipboardDocumentIcon className="h-4 w-4 text-gray-700" />
        </button>
        <button
          onClick={handleDownloadImage}
          disabled={!!error}
          className="rounded-lg bg-white p-2 shadow-md transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          title={t('operation.download', { ns: 'common' })}
        >
          <ArrowDownTrayIcon className="h-4 w-4 text-gray-700" />
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-red-50">
          <div className="p-4 text-center">
            <p className="mb-2 font-medium text-red-600">Error</p>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        </div>
      )}

      {/* Infographic Container */}
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-lg bg-white"
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      />
    </div>
  )
}

export default InfographicViewer
