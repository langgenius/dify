'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { Infographic as InfographicEngine } from '@antv/infographic'
import { memo, useEffect, useRef, useState } from 'react'

type InfographicRendererProps = {
  PrimitiveCode: string
  className?: string
}

type RenderState = 'loading' | 'success' | 'error'

const InfographicRenderer = memo(({ PrimitiveCode, className }: InfographicRendererProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<InfographicEngine | null>(null)
  const [state, setState] = useState<RenderState>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container || !PrimitiveCode.trim())
      return

    let cancelled = false
    let retryCount = 0
    const MAX_RETRIES = 2

    const render = async () => {
      try {
        setState('loading')
        setErrorMsg('')

        // Clean up previous engine instance
        if (engineRef.current) {
          engineRef.current.destroy()
          engineRef.current = null
        }

        const trimmedCode = PrimitiveCode.trim()

        // Validate minimum length
        if (trimmedCode.length < 10) {
          if (!cancelled) {
            setState('error')
            setErrorMsg('Infographic code is too short or incomplete.')
          }
          return
        }

        const engine = new InfographicEngine(trimmedCode)
        engineRef.current = engine

        // Listen for errors
        engine.on('error', (error: Error) => {
          if (!cancelled) {
            setState('error')
            setErrorMsg(error.message || 'Failed to render infographic')
          }
        })

        // Listen for warnings
        engine.on('warning', (warnings: any[]) => {
          if (!cancelled && warnings.length > 0) {
            console.warn('[Infographic] Warnings:', warnings)
          }
        })

        // Listen for successful render
        engine.on('rendered', () => {
          if (!cancelled)
            setState('success')
        })

        // Ensure container is empty before rendering
        const existingWidget = container.querySelector('[data-infographic-widget]')
        if (existingWidget)
          existingWidget.remove()

        // Create a wrapper inside the container for the Infographic engine
        const wrapper = document.createElement('div')
        wrapper.setAttribute('data-infographic-widget', '')
        wrapper.style.width = '100%'
        wrapper.style.minHeight = '200px'
        container.appendChild(wrapper)

        // Pass container reference and render
        engine.setOptions({ container: wrapper })
        engine.render()

        if (!cancelled)
          setState('success')
      }
      catch (error) {
        if (!cancelled && retryCount < MAX_RETRIES) {
          retryCount++
          console.warn(`[Infographic] Retry ${retryCount}/${MAX_RETRIES} after error:`, error)
          setTimeout(render, 300)
        }
        else if (!cancelled) {
          console.error('[Infographic] Render error:', error)
          setState('error')
          setErrorMsg((error as Error).message || 'Unknown error rendering infographic')
        }
      }
    }

    render()

    return () => {
      cancelled = true
      if (engineRef.current) {
        engineRef.current.destroy()
        engineRef.current = null
      }
    }
  }, [PrimitiveCode])

  return (
    <div className={cn('relative w-full overflow-x-auto rounded-b-[10px]', className)}>
      {state === 'loading' && (
        <div
          className="flex min-h-[200px] w-full items-center justify-center"
          style={{
            backgroundColor: 'var(--color-components-input-bg-normal)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <div className="flex flex-col items-center gap-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ animation: 'spin 1.5s linear infinite' }}>
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
              <circle opacity="0.2" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M12 2C6.47715 2 2 6.47715 2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="system-sm-regular">Infographic loading...</span>
          </div>
        </div>
      )}
      {state === 'error' && (
        <div
          className="flex min-h-[200px] w-full flex-col items-center justify-center gap-2"
          style={{
            backgroundColor: 'var(--color-components-input-bg-normal)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="12" fill="currentColor" opacity="0.1" />
            <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="system-sm-regular text-text-warning-secondary">Failed to render infographic</span>
          {errorMsg && (
            <span className="system-xs-regular" style={{ color: 'var(--color-text-tertiary)' }}>
              {errorMsg}
            </span>
          )}
        </div>
      )}
      <div
        ref={containerRef}
        className={cn(
          'w-full',
          state === 'success' ? 'block' : 'hidden',
        )}
        style={{
          minHeight: '200px',
          backgroundColor: 'var(--color-components-input-bg-normal)',
        }}
      />
    </div>
  )
})

InfographicRenderer.displayName = 'InfographicRenderer'

export default InfographicRenderer
