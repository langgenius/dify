import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { useTranslation } from 'react-i18next'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { MoonIcon, SunIcon } from '@heroicons/react/24/solid'
import {
  cleanUpSvgCode,
  isMermaidCodeComplete,
  prepareMermaidCode,
  processSvgForTheme,
  svgToBase64,
  waitForDOMElement,
} from './utils'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import cn from '@/utils/classnames'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import { Theme } from '@/types/app'

// Global flags and cache for mermaid
let isMermaidInitialized = false
const diagramCache = new Map<string, string>()
let mermaidAPI: any = null

if (typeof window !== 'undefined')
  mermaidAPI = mermaid.mermaidAPI

// Theme configurations
const THEMES = {
  light: {
    name: 'Light Theme',
    background: '#ffffff',
    primaryColor: '#ffffff',
    primaryBorderColor: '#000000',
    primaryTextColor: '#000000',
    secondaryColor: '#ffffff',
    tertiaryColor: '#ffffff',
    nodeColors: [
      { bg: '#f0f9ff', color: '#0369a1' },
      { bg: '#f0fdf4', color: '#166534' },
      { bg: '#fef2f2', color: '#b91c1c' },
      { bg: '#faf5ff', color: '#7e22ce' },
      { bg: '#fffbeb', color: '#b45309' },
    ],
    connectionColor: '#74a0e0',
  },
  dark: {
    name: 'Dark Theme',
    background: '#1e293b',
    primaryColor: '#334155',
    primaryBorderColor: '#94a3b8',
    primaryTextColor: '#e2e8f0',
    secondaryColor: '#475569',
    tertiaryColor: '#334155',
    nodeColors: [
      { bg: '#164e63', color: '#e0f2fe' },
      { bg: '#14532d', color: '#dcfce7' },
      { bg: '#7f1d1d', color: '#fee2e2' },
      { bg: '#581c87', color: '#f3e8ff' },
      { bg: '#78350f', color: '#fef3c7' },
    ],
    connectionColor: '#60a5fa',
  },
}

/**
 * Initializes mermaid library with default configuration
 */
const initMermaid = () => {
  if (typeof window !== 'undefined' && !isMermaidInitialized) {
    try {
      mermaid.initialize({
        startOnLoad: false,
        fontFamily: 'sans-serif',
        securityLevel: 'loose',
        flowchart: {
          htmlLabels: true,
          useMaxWidth: true,
          diagramPadding: 10,
          curve: 'basis',
          nodeSpacing: 50,
          rankSpacing: 70,
        },
        gantt: {
          titleTopMargin: 25,
          barHeight: 20,
          barGap: 4,
          topPadding: 50,
          leftPadding: 75,
          gridLineStartPadding: 35,
          fontSize: 11,
          numberSectionStyles: 4,
          axisFormat: '%Y-%m-%d',
        },
        maxTextSize: 50000,
      })
      isMermaidInitialized = true
    }
    catch (error) {
      console.error('Mermaid initialization error:', error)
      return null
    }
  }
  return isMermaidInitialized
}

const Flowchart = React.forwardRef((props: {
  PrimitiveCode: string
  theme?: 'light' | 'dark'
}, ref) => {
  const { t } = useTranslation()
  const [svgCode, setSvgCode] = useState<string | null>(null)
  const [look, setLook] = useState<'classic' | 'handDrawn'>('classic')
  const [isInitialized, setIsInitialized] = useState(false)
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(props.theme || 'light')
  const containerRef = useRef<HTMLDivElement>(null)
  const chartId = useRef(`mermaid-chart-${Math.random().toString(36).substr(2, 9)}`).current
  const [isLoading, setIsLoading] = useState(true)
  const renderTimeoutRef = useRef<NodeJS.Timeout>()
  const [errMsg, setErrMsg] = useState('')
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  const [isCodeComplete, setIsCodeComplete] = useState(false)
  const codeCompletionCheckRef = useRef<NodeJS.Timeout>()

  // Create cache key from code, style and theme
  const cacheKey = useMemo(() => {
    return `${props.PrimitiveCode}-${look}-${currentTheme}`
  }, [props.PrimitiveCode, look, currentTheme])

  /**
   * Renders Mermaid chart
   */
  const renderMermaidChart = async (code: string, style: 'classic' | 'handDrawn') => {
    if (style === 'handDrawn') {
      // Special handling for hand-drawn style
      if (containerRef.current)
        containerRef.current.innerHTML = `<div id="${chartId}"></div>`
      await new Promise(resolve => setTimeout(resolve, 30))

      if (typeof window !== 'undefined' && mermaidAPI) {
        // Prefer using mermaidAPI directly for hand-drawn style
        return await mermaidAPI.render(chartId, code)
      }
      else {
        // Fall back to standard rendering if mermaidAPI is not available
        const { svg } = await mermaid.render(chartId, code)
        return { svg }
      }
    }
    else {
      // Standard rendering for classic style - using the extracted waitForDOMElement function
      const renderWithRetry = async () => {
        if (containerRef.current)
          containerRef.current.innerHTML = `<div id="${chartId}"></div>`
        await new Promise(resolve => setTimeout(resolve, 30))
        const { svg } = await mermaid.render(chartId, code)
        return { svg }
      }
      return await waitForDOMElement(renderWithRetry)
    }
  }

  /**
   * Handle rendering errors
   */
  const handleRenderError = (error: any) => {
    console.error('Mermaid rendering error:', error)
    const errorMsg = (error as Error).message

    if (errorMsg.includes('getAttribute')) {
      diagramCache.clear()
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
      })
    }
    else {
      setErrMsg(`Rendering chart failed, please refresh and try again ${look === 'handDrawn' ? 'Or try using classic mode' : ''}`)
    }

    if (look === 'handDrawn') {
      try {
        // Clear possible cache issues
        diagramCache.delete(`${props.PrimitiveCode}-handDrawn-${currentTheme}`)

        // Reset mermaid configuration
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'default',
          maxTextSize: 50000,
        })

        // Try rendering with standard mode
        setLook('classic')
        setErrMsg('Hand-drawn mode is not supported for this diagram. Switched to classic mode.')

        // Delay error clearing
        setTimeout(() => {
          if (containerRef.current) {
            // Try rendering again with standard mode, but can't call renderFlowchart directly due to circular dependency
            // Instead set state to trigger re-render
            setIsCodeComplete(true) // This will trigger useEffect re-render
          }
        }, 500)
      }
      catch (e) {
        console.error('Reset after handDrawn error failed:', e)
      }
    }

    setIsLoading(false)
  }

  // Initialize mermaid
  useEffect(() => {
    const api = initMermaid()
    if (api)
      setIsInitialized(true)
  }, [])

  // Update theme when prop changes
  useEffect(() => {
    if (props.theme)
      setCurrentTheme(props.theme)
  }, [props.theme])

  // Validate mermaid code and check for completeness
  useEffect(() => {
    if (codeCompletionCheckRef.current)
      clearTimeout(codeCompletionCheckRef.current)

    // Reset code complete status when code changes
    setIsCodeComplete(false)

    // If no code or code is extremely short, don't proceed
    if (!props.PrimitiveCode || props.PrimitiveCode.length < 10)
      return

    // Check if code already in cache - if so we know it's valid
    if (diagramCache.has(cacheKey)) {
      setIsCodeComplete(true)
      return
    }

    // Initial check using the extracted isMermaidCodeComplete function
    const isComplete = isMermaidCodeComplete(props.PrimitiveCode)
    if (isComplete) {
      setIsCodeComplete(true)
      return
    }

    // Set a delay to check again in case code is still being generated
    codeCompletionCheckRef.current = setTimeout(() => {
      setIsCodeComplete(isMermaidCodeComplete(props.PrimitiveCode))
    }, 300)

    return () => {
      if (codeCompletionCheckRef.current)
        clearTimeout(codeCompletionCheckRef.current)
    }
  }, [props.PrimitiveCode, cacheKey])

  /**
   * Renders flowchart based on provided code
   */
  const renderFlowchart = useCallback(async (primitiveCode: string) => {
    if (!isInitialized || !containerRef.current) {
      setIsLoading(false)
      setErrMsg(!isInitialized ? 'Mermaid initialization failed' : 'Container element not found')
      return
    }

    // Don't render if code is not complete yet
    if (!isCodeComplete) {
      setIsLoading(true)
      return
    }

    // Return cached result if available
    if (diagramCache.has(cacheKey)) {
      setSvgCode(diagramCache.get(cacheKey) || null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setErrMsg('')

    try {
      let finalCode: string

      // Check if it's a gantt chart
      const isGanttChart = primitiveCode.trim().startsWith('gantt')

      if (isGanttChart) {
        // For gantt charts, ensure each task is on its own line
        // and preserve exact whitespace/format
        finalCode = primitiveCode.trim()
      }
      else {
        // Step 1: Clean and prepare Mermaid code using the extracted prepareMermaidCode function
        finalCode = prepareMermaidCode(primitiveCode, look)
      }

      // Step 2: Render chart
      const svgGraph = await renderMermaidChart(finalCode, look)

      // Step 3: Apply theme to SVG using the extracted processSvgForTheme function
      const processedSvg = processSvgForTheme(
        svgGraph.svg,
        currentTheme === Theme.dark,
        look === 'handDrawn',
        THEMES,
      )

      // Step 4: Clean SVG code and convert to base64 using the extracted functions
      const cleanedSvg = cleanUpSvgCode(processedSvg)
      const base64Svg = await svgToBase64(cleanedSvg)

      if (base64Svg && typeof base64Svg === 'string') {
        diagramCache.set(cacheKey, base64Svg)
        setSvgCode(base64Svg)
      }

      setIsLoading(false)
    }
    catch (error) {
      // Error handling
      handleRenderError(error)
    }
  }, [chartId, isInitialized, cacheKey, isCodeComplete, look, currentTheme, t])

  /**
   * Configure mermaid based on selected style and theme
   */
  const configureMermaid = useCallback(() => {
    if (typeof window !== 'undefined' && isInitialized) {
      const themeVars = THEMES[currentTheme]
      const config: any = {
        startOnLoad: false,
        securityLevel: 'loose',
        fontFamily: 'sans-serif',
        maxTextSize: 50000,
        gantt: {
          titleTopMargin: 25,
          barHeight: 20,
          barGap: 4,
          topPadding: 50,
          leftPadding: 75,
          gridLineStartPadding: 35,
          fontSize: 11,
          numberSectionStyles: 4,
          axisFormat: '%Y-%m-%d',
        },
      }

      if (look === 'classic') {
        config.theme = currentTheme === 'dark' ? 'dark' : 'neutral'
        config.flowchart = {
          htmlLabels: true,
          useMaxWidth: true,
          diagramPadding: 12,
          nodeSpacing: 60,
          rankSpacing: 80,
          curve: 'linear',
          ranker: 'tight-tree',
        }
      }
      else {
        config.theme = 'default'
        config.themeCSS = `
          .node rect { fill-opacity: 0.85; }
          .edgePath .path { stroke-width: 1.5px; }
          .label { font-family: 'sans-serif'; }
          .edgeLabel { font-family: 'sans-serif'; }
          .cluster rect { rx: 5px; ry: 5px; }
        `
        config.themeVariables = {
          fontSize: '14px',
          fontFamily: 'sans-serif',
        }
        config.flowchart = {
          htmlLabels: true,
          useMaxWidth: true,
          diagramPadding: 10,
          nodeSpacing: 40,
          rankSpacing: 60,
          curve: 'basis',
        }
        config.themeVariables.primaryBorderColor = currentTheme === 'dark' ? THEMES.dark.connectionColor : THEMES.light.connectionColor
      }

      if (currentTheme === 'dark' && !config.themeVariables) {
        config.themeVariables = {
          background: themeVars.background,
          primaryColor: themeVars.primaryColor,
          primaryBorderColor: themeVars.primaryBorderColor,
          primaryTextColor: themeVars.primaryTextColor,
          secondaryColor: themeVars.secondaryColor,
          tertiaryColor: themeVars.tertiaryColor,
          fontFamily: 'sans-serif',
        }
      }

      try {
        mermaid.initialize(config)
        return true
      }
      catch (error) {
        console.error('Config error:', error)
        return false
      }
    }
    return false
  }, [currentTheme, isInitialized, look])

  // Effect for theme and style configuration
  useEffect(() => {
    if (diagramCache.has(cacheKey)) {
      setSvgCode(diagramCache.get(cacheKey) || null)
      setIsLoading(false)
      return
    }

    if (configureMermaid() && containerRef.current && isCodeComplete)
      renderFlowchart(props.PrimitiveCode)
  }, [look, props.PrimitiveCode, renderFlowchart, isInitialized, cacheKey, currentTheme, isCodeComplete, configureMermaid])

  // Effect for rendering with debounce
  useEffect(() => {
    if (diagramCache.has(cacheKey)) {
      setSvgCode(diagramCache.get(cacheKey) || null)
      setIsLoading(false)
      return
    }

    if (renderTimeoutRef.current)
      clearTimeout(renderTimeoutRef.current)

    if (isCodeComplete) {
      renderTimeoutRef.current = setTimeout(() => {
        if (isInitialized)
          renderFlowchart(props.PrimitiveCode)
      }, 300)
    }
    else {
      setIsLoading(true)
    }

    return () => {
      if (renderTimeoutRef.current)
        clearTimeout(renderTimeoutRef.current)
    }
  }, [props.PrimitiveCode, renderFlowchart, isInitialized, cacheKey, isCodeComplete])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (containerRef.current)
        containerRef.current.innerHTML = ''
      if (renderTimeoutRef.current)
        clearTimeout(renderTimeoutRef.current)
      if (codeCompletionCheckRef.current)
        clearTimeout(codeCompletionCheckRef.current)
    }
  }, [])

  const toggleTheme = () => {
    setCurrentTheme(prevTheme => prevTheme === 'light' ? Theme.dark : Theme.light)
    diagramCache.clear()
  }

  // Style classes for theme-dependent elements
  const themeClasses = {
    container: cn('relative', {
      'bg-white': currentTheme === Theme.light,
      'bg-slate-900': currentTheme === Theme.dark,
    }),
    mermaidDiv: cn('mermaid relative h-auto w-full cursor-pointer', {
      'bg-white': currentTheme === Theme.light,
      'bg-slate-900': currentTheme === Theme.dark,
    }),
    errorMessage: cn('px-[26px] py-4', {
      'text-red-500': currentTheme === Theme.light,
      'text-red-400': currentTheme === Theme.dark,
    }),
    errorIcon: cn('h-6 w-6', {
      'text-red-500': currentTheme === Theme.light,
      'text-red-400': currentTheme === Theme.dark,
    }),
    segmented: cn('msh-segmented msh-segmented-sm css-23bs09 css-var-r1', {
      'text-gray-700': currentTheme === Theme.light,
      'text-gray-300': currentTheme === Theme.dark,
    }),
    themeToggle: cn('flex h-10 w-10 items-center justify-center rounded-full shadow-md backdrop-blur-sm transition-all duration-300', {
      'bg-white/80 hover:bg-white hover:shadow-lg text-gray-700 border border-gray-200': currentTheme === Theme.light,
      'bg-slate-800/80 hover:bg-slate-700 hover:shadow-lg text-yellow-300 border border-slate-600': currentTheme === Theme.dark,
    }),
  }

  // Style classes for look options
  const getLookButtonClass = (lookType: 'classic' | 'handDrawn') => {
    return cn(
      'system-sm-medium mb-4 flex h-8 w-[calc((100%-8px)/2)] cursor-pointer items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg text-text-secondary',
      look === lookType && 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg text-text-primary',
      currentTheme === Theme.dark && 'border-slate-600 bg-slate-800 text-slate-300',
      look === lookType && currentTheme === Theme.dark && 'border-blue-500 bg-slate-700 text-white',
    )
  }

  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} className={themeClasses.container}>
      <div className={themeClasses.segmented}>
        <div className="msh-segmented-group">
          <label className="msh-segmented-item m-2 flex w-[200px] items-center space-x-1">
            <div
              key='classic'
              className={getLookButtonClass('classic')}
              onClick={() => setLook('classic')}
            >
              <div className="msh-segmented-item-label">{t('app.mermaid.classic')}</div>
            </div>
            <div
              key='handDrawn'
              className={getLookButtonClass('handDrawn')}
              onClick={() => setLook('handDrawn')}
            >
              <div className="msh-segmented-item-label">{t('app.mermaid.handDrawn')}</div>
            </div>
          </label>
        </div>
      </div>

      <div ref={containerRef} style={{ position: 'absolute', visibility: 'hidden', height: 0, overflow: 'hidden' }} />

      {isLoading && !svgCode && (
        <div className='px-[26px] py-4'>
          <LoadingAnim type='text'/>
          {!isCodeComplete && (
            <div className="mt-2 text-sm text-gray-500">
              {t('common.wait_for_completion', 'Waiting for diagram code to complete...')}
            </div>
          )}
        </div>
      )}

      {svgCode && (
        <div className={themeClasses.mermaidDiv} style={{ objectFit: 'cover' }} onClick={() => setImagePreviewUrl(svgCode)}>
          <div className="absolute bottom-2 left-2 z-[100]">
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleTheme()
              }}
              className={themeClasses.themeToggle}
              title={(currentTheme === Theme.light ? t('app.theme.switchDark') : t('app.theme.switchLight')) || ''}
              style={{ transform: 'translate3d(0, 0, 0)' }}
            >
              {currentTheme === Theme.light ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
            </button>
          </div>

          <img
            src={svgCode}
            alt="mermaid_chart"
            style={{ maxWidth: '100%' }}
            onError={() => { setErrMsg('Chart rendering failed, please refresh and retry') }}
          />
        </div>
      )}

      {errMsg && (
        <div className={themeClasses.errorMessage}>
          <div className="flex items-center">
            <ExclamationTriangleIcon className={themeClasses.errorIcon}/>
            <span className="ml-2">{errMsg}</span>
          </div>
        </div>
      )}

      {imagePreviewUrl && (
        <ImagePreview title='mermaid_chart' url={imagePreviewUrl} onCancel={() => setImagePreviewUrl('')} />
      )}
    </div>
  )
})

Flowchart.displayName = 'Flowchart'

export default Flowchart
