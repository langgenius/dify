'use client'

import { Infographic } from '@antv/infographic'
import { ArrowDownTrayIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import * as React from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'

export type InfographicProps = {
  syntax: string
  className?: string
  height?: number
  width?: number | string
  onError?: (error: unknown, info: React.ErrorInfo) => void
}

type ErrorFallbackProps = {
  error: unknown
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({ error }) => {
  const errorMessage = error instanceof Error ? error.message : 'Failed to render infographic'
  return (
    <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-red-50">
      <div className="p-4 text-center">
        <p className="mb-2 font-medium text-red-600">Error</p>
        <p className="text-sm text-red-500">{errorMessage}</p>
      </div>
    </div>
  )
}

type InfographicContentProps = Omit<InfographicProps, 'onError'>

const InfographicContent: React.FC<InfographicContentProps> = ({
  syntax,
  height = 600,
  width = '100%',
}) => {
  const { t } = useTranslation()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const infographicRef = React.useRef<Infographic | null>(null)
  const [renderError, setRenderError] = React.useState<Error | null>(null)

  // Throw error during render so ErrorBoundary can catch it
  if (renderError)
    throw renderError

  React.useEffect(() => {
    // Use requestAnimationFrame to ensure container is mounted
    const frameId = requestAnimationFrame(() => {
      if (!containerRef.current)
        return

      try {
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

        // Render the infographic with the syntax (synchronous)
        infographic.render(syntax)
        infographicRef.current = infographic
        setRenderError(null) // Clear any previous errors
      }
      catch (err) {
        // Set error state which will be thrown on next render
        setRenderError(err instanceof Error ? err : new Error('Failed to render infographic'))
      }
    })

    return () => {
      cancelAnimationFrame(frameId)
      if (infographicRef.current) {
        infographicRef.current.destroy()
        infographicRef.current = null
      }
    }
  }, [syntax, width, height])

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

      const handleImageLoad = () => {
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

      img.onload = handleImageLoad
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
    <>
      {/* Toolbar */}
      <div className="absolute right-2 top-2 z-10 flex gap-2">
        <button
          onClick={handleCopyImage}
          className="rounded-lg bg-white p-2 shadow-md transition-colors hover:bg-gray-50"
          title={t('operation.copy', { ns: 'common' })}
        >
          <ClipboardDocumentIcon className="h-4 w-4 text-gray-700" />
        </button>
        <button
          onClick={handleDownloadImage}
          className="rounded-lg bg-white p-2 shadow-md transition-colors hover:bg-gray-50"
          title={t('operation.download', { ns: 'common' })}
        >
          <ArrowDownTrayIcon className="h-4 w-4 text-gray-700" />
        </button>
      </div>

      {/* Infographic Container */}
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-lg bg-white"
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      />
    </>
  )
}

const InfographicViewer: React.FC<InfographicProps> = ({
  syntax,
  className = '',
  height = 600,
  width = '100%',
  onError,
}) => {
  return (
    <div className={`relative ${className}`}>
      <ErrorBoundary
        FallbackComponent={ErrorFallback}
        onError={onError}
        resetKeys={[syntax]}
      >
        <InfographicContent
          syntax={syntax}
          height={height}
          width={width}
        />
      </ErrorBoundary>
    </div>
  )
}

export default InfographicViewer
