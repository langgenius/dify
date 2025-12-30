import type { MermaidConfig } from 'mermaid'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { MoonIcon, SunIcon } from '@heroicons/react/24/solid'
import mermaid from 'mermaid'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import { Theme } from '@/types/app'
import { cn } from '@/utils/classnames'
import {
  cleanUpSvgCode,
  isMermaidCodeComplete,
  prepareMermaidCode,
  processSvgForTheme,
  sanitizeMermaidCode,
  svgToBase64,
  waitForDOMElement,
} from './utils'

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
      const config: MermaidConfig = {
        startOnLoad: false,
        fontFamily: 'sans-serif',
        securityLevel: 'strict',
        flowchart: {
          htmlLabels: true,
          useMaxWidth: true,
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
        mindmap: {
          useMaxWidth: true,
          padding: 10,
        },
        maxTextSize: 50000,
      }
      mermaid.initialize(config)
      isMermaidInitialized = true
    }
    catch (error) {
      console.error('Mermaid initialization error:', error)
      return null
    }
  }
  return isMermaidInitialized
}

type FlowchartProps = {
  PrimitiveCode: string
  theme?: 'light' | 'dark'
  ref?: React.Ref<HTMLDivElement>
}

const Flowchart = (props: FlowchartProps) => {
  const { t } = useTranslation()
  const [svgString, setSvgString] = useState<string | null>(null)
  const [look, setLook] = useState<'classic' | 'handDrawn'>('classic')
  const [isInitialized, setIsInitialized] = useState(false)
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(props.theme || 'light')
  const containerRef = useRef<HTMLDivElement>(null)
  const chartId = useRef(`mermaid-chart-${Math.random().toString(36).slice(2, 11)}`).current
  const [isLoading, setIsLoading] = useState(true)
  const renderTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const [errMsg, setErrMsg] = useState('')
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')

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

    // On any render error, assume the mermaid state is corrupted and force a re-initialization.
    try {
      diagramCache.clear() // Clear cache to prevent using potentially corrupted SVGs
      isMermaidInitialized = false // <-- THE FIX: Force re-initialization
      initMermaid() // Re-initialize with the default safe configuration
    }
    catch (reinitError) {
      console.error('Failed to re-initialize Mermaid after error:', reinitError)
    }

    setErrMsg(`Rendering failed: ${(error as Error).message || 'Unknown error. Please check the console.'}`)
    setIsLoading(false)
  }

  // Initialize mermaid
  useEffect(() => {
    const api = initMermaid()
    if (api)
      setIsInitialized(true)
  }, [])

  // Update theme when prop changes, but allow internal override.
  const prevThemeRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    // Only react if the theme prop from the outside has actually changed.
    if (props.theme && props.theme !== prevThemeRef.current) {
      // When the global theme prop changes, it should act as the source of truth,
      // overriding any local theme selection.
      diagramCache.clear()
      setSvgString(null)
      setCurrentTheme(props.theme)
      // Reset look to classic for a consistent state after a global change.
      setLook('classic')
    }
    // Update the ref to the current prop value for the next render.
    prevThemeRef.current = props.theme
  }, [props.theme])

  const renderFlowchart = useCallback(async (primitiveCode: string) => {
    if (!isInitialized || !containerRef.current) {
      setIsLoading(false)
      setErrMsg(!isInitialized ? 'Mermaid initialization failed' : 'Container element not found')
      return
    }

    // Return cached result if available
    const cacheKey = `${primitiveCode}-${look}-${currentTheme}`
    if (diagramCache.has(cacheKey)) {
      setErrMsg('')
      setSvgString(diagramCache.get(cacheKey) || null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setErrMsg('')

    try {
      let finalCode: string

      const trimmedCode = primitiveCode.trim()
      const isGantt = trimmedCode.startsWith('gantt')
      const isMindMap = trimmedCode.startsWith('mindmap')
      const isSequence = trimmedCode.startsWith('sequenceDiagram')

      if (isGantt || isMindMap || isSequence) {
        if (isGantt) {
          finalCode = trimmedCode
            .split('\n')
            .map((line) => {
              // Gantt charts have specific syntax needs.
              const taskMatch = line.match(/^\s*([^:]+?)\s*:\s*(.*)/)
              if (!taskMatch)
                return line // Not a task line, return as is.

              const taskName = taskMatch[1].trim()
              let paramsStr = taskMatch[2].trim()

              // Rule 1: Correct multiple "after" dependencies ONLY if they exist.
              // This is a common mistake, e.g., "..., after task1, after task2, ..."
              const afterCount = (paramsStr.match(/after /g) || []).length
              if (afterCount > 1)
                paramsStr = paramsStr.replace(/,\s*after\s+/g, ' ')

              // Rule 2: Normalize spacing between parameters for consistency.
              const finalParams = paramsStr.replace(/\s*,\s*/g, ', ').trim()
              return `${taskName} :${finalParams}`
            })
            .join('\n')
        }
        else {
          // For mindmap and sequence charts, which are sensitive to syntax,
          // pass the code through directly.
          finalCode = trimmedCode
        }
      }
      else {
        // Step 1: Clean and prepare Mermaid code using the extracted prepareMermaidCode function
        // This function handles flowcharts appropriately.
        finalCode = prepareMermaidCode(primitiveCode, look)
      }

      finalCode = sanitizeMermaidCode(finalCode)

      // Step 2: Render chart
      const svgGraph = await renderMermaidChart(finalCode, look)

      // Step 3: Apply theme to SVG using the extracted processSvgForTheme function
      const processedSvg = processSvgForTheme(
        svgGraph.svg,
        currentTheme === Theme.dark,
        look === 'handDrawn',
        THEMES,
      )

      // Step 4: Clean up SVG code
      const cleanedSvg = cleanUpSvgCode(processedSvg)

      if (cleanedSvg && typeof cleanedSvg === 'string') {
        diagramCache.set(cacheKey, cleanedSvg)
        setSvgString(cleanedSvg)
      }

      setIsLoading(false)
    }
    catch (error) {
      // Error handling
      handleRenderError(error)
    }
  }, [chartId, isInitialized, look, currentTheme, t])

  const configureMermaid = useCallback((primitiveCode: string) => {
    if (typeof window !== 'undefined' && isInitialized) {
      const themeVars = THEMES[currentTheme]
      const config: MermaidConfig = {
        startOnLoad: false,
        securityLevel: 'strict',
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
        mindmap: {
          useMaxWidth: true,
          padding: 10,
        },
      }

      const isFlowchart = primitiveCode.trim().startsWith('graph') || primitiveCode.trim().startsWith('flowchart')

      if (look === 'classic') {
        config.theme = currentTheme === 'dark' ? 'dark' : 'neutral'

        if (isFlowchart) {
          type FlowchartConfigWithRanker = NonNullable<MermaidConfig['flowchart']> & { ranker?: string }
          const flowchartConfig: FlowchartConfigWithRanker = {
            htmlLabels: true,
            useMaxWidth: true,
            nodeSpacing: 60,
            rankSpacing: 80,
            curve: 'linear',
            ranker: 'tight-tree',
          }
          config.flowchart = flowchartConfig as unknown as MermaidConfig['flowchart']
        }

        if (currentTheme === 'dark') {
          config.themeVariables = {
            background: themeVars.background,
            primaryColor: themeVars.primaryColor,
            primaryBorderColor: themeVars.primaryBorderColor,
            primaryTextColor: themeVars.primaryTextColor,
            secondaryColor: themeVars.secondaryColor,
            tertiaryColor: themeVars.tertiaryColor,
          }
        }
      }
      else { // look === 'handDrawn'
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
          primaryBorderColor: currentTheme === 'dark' ? THEMES.dark.connectionColor : THEMES.light.connectionColor,
        }

        if (isFlowchart) {
          config.flowchart = {
            htmlLabels: true,
            useMaxWidth: true,
            nodeSpacing: 40,
            rankSpacing: 60,
            curve: 'basis',
          }
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

  // This is the main rendering effect.
  // It triggers whenever the code, theme, or style changes.
  useEffect(() => {
    if (!isInitialized)
      return

    // Don't render if code is too short
    if (!props.PrimitiveCode || props.PrimitiveCode.length < 10) {
      setIsLoading(false)
      setSvgString(null)
      return
    }

    // Use a timeout to handle streaming code and debounce rendering
    if (renderTimeoutRef.current)
      clearTimeout(renderTimeoutRef.current)

    setIsLoading(true)

    renderTimeoutRef.current = setTimeout(() => {
      // Final validation before rendering
      if (!isMermaidCodeComplete(props.PrimitiveCode)) {
        setIsLoading(false)
        setErrMsg('Diagram code is not complete or invalid.')
        return
      }

      const cacheKey = `${props.PrimitiveCode}-${look}-${currentTheme}`
      if (diagramCache.has(cacheKey)) {
        setErrMsg('')
        setSvgString(diagramCache.get(cacheKey) || null)
        setIsLoading(false)
        return
      }

      if (configureMermaid(props.PrimitiveCode))
        renderFlowchart(props.PrimitiveCode)
    }, 300) // 300ms debounce

    return () => {
      if (renderTimeoutRef.current)
        clearTimeout(renderTimeoutRef.current)
    }
  }, [props.PrimitiveCode, look, currentTheme, isInitialized, configureMermaid, renderFlowchart])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (containerRef.current)
        containerRef.current.innerHTML = ''
      if (renderTimeoutRef.current)
        clearTimeout(renderTimeoutRef.current)
    }
  }, [])

  const handlePreviewClick = async () => {
    if (svgString) {
      const base64 = await svgToBase64(svgString)
      setImagePreviewUrl(base64)
    }
  }

  const toggleTheme = () => {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light'
    // Ensure a full, clean re-render cycle, consistent with global theme change.
    diagramCache.clear()
    setSvgString(null)
    setCurrentTheme(newTheme)
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
    <div ref={props.ref as React.RefObject<HTMLDivElement>} className={themeClasses.container}>
      <div className={themeClasses.segmented}>
        <div className="msh-segmented-group">
          <label className="msh-segmented-item m-2 flex w-[200px] items-center space-x-1">
            <div
              key="classic"
              className={getLookButtonClass('classic')}
              onClick={() => {
                if (look !== 'classic') {
                  diagramCache.clear()
                  setSvgString(null)
                  setLook('classic')
                }
              }}
            >
              <div className="msh-segmented-item-label">{t('mermaid.classic', { ns: 'app' })}</div>
            </div>
            <div
              key="handDrawn"
              className={getLookButtonClass('handDrawn')}
              onClick={() => {
                if (look !== 'handDrawn') {
                  diagramCache.clear()
                  setSvgString(null)
                  setLook('handDrawn')
                }
              }}
            >
              <div className="msh-segmented-item-label">{t('mermaid.handDrawn', { ns: 'app' })}</div>
            </div>
          </label>
        </div>
      </div>

      <div ref={containerRef} style={{ position: 'absolute', visibility: 'hidden', height: 0, overflow: 'hidden' }} />

      {isLoading && !svgString && (
        <div className="px-[26px] py-4">
          <LoadingAnim type="text" />
          <div className="mt-2 text-sm text-gray-500">
            {t('wait_for_completion', { ns: 'common', defaultValue: 'Waiting for diagram code to complete...' })}
          </div>
        </div>
      )}

      {svgString && (
        <div className={themeClasses.mermaidDiv} style={{ objectFit: 'cover' }} onClick={handlePreviewClick}>
          <div className="absolute bottom-2 left-2 z-[100]">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleTheme()
              }}
              className={themeClasses.themeToggle}
              title={(currentTheme === Theme.light ? t('theme.switchDark', { ns: 'app' }) : t('theme.switchLight', { ns: 'app' })) || ''}
              style={{ transform: 'translate3d(0, 0, 0)' }}
            >
              {currentTheme === Theme.light ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
            </button>
          </div>

          <div
            style={{ maxWidth: '100%' }}
            dangerouslySetInnerHTML={{ __html: svgString }}
          />
        </div>
      )}

      {errMsg && (
        <div className={themeClasses.errorMessage}>
          <div className="flex items-center">
            <ExclamationTriangleIcon className={themeClasses.errorIcon} />
            <span className="ml-2">{errMsg}</span>
          </div>
        </div>
      )}

      {imagePreviewUrl && (
        <ImagePreview title="mermaid_chart" url={imagePreviewUrl} onCancel={() => setImagePreviewUrl('')} />
      )}
    </div>
  )
}

Flowchart.displayName = 'Flowchart'

export default Flowchart
