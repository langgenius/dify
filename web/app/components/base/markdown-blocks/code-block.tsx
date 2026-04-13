import type { JSX } from 'react'
import type { BundledLanguage, BundledTheme } from 'shiki/bundle/web'
import ReactEcharts from 'echarts-for-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ActionButton from '@/app/components/base/action-button'
import CopyIcon from '@/app/components/base/copy-icon'
import MarkdownMusic from '@/app/components/base/markdown-blocks/music'
import ErrorBoundary from '@/app/components/base/markdown/error-boundary'
import SVGBtn from '@/app/components/base/svg'
import useTheme from '@/hooks/use-theme'
import dynamic from '@/next/dynamic'
import { Theme } from '@/types/app'
import SVGRenderer from '../svg-gallery' // Assumes svg-gallery.tsx is in /base directory
import { highlightCode } from './shiki-highlight'

const Flowchart = dynamic(() => import('@/app/components/base/mermaid'), { ssr: false })

const capitalizationLanguageNameMap: Record<string, string> = {
  sql: 'SQL',
  javascript: 'JavaScript',
  java: 'Java',
  typescript: 'TypeScript',
  vbscript: 'VBScript',
  css: 'CSS',
  html: 'HTML',
  xml: 'XML',
  php: 'PHP',
  python: 'Python',
  yaml: 'Yaml',
  mermaid: 'Mermaid',
  markdown: 'MarkDown',
  makefile: 'MakeFile',
  echarts: 'ECharts',
  shell: 'Shell',
  powershell: 'PowerShell',
  json: 'JSON',
  latex: 'Latex',
  svg: 'SVG',
  abc: 'ABC',
}
const getCorrectCapitalizationLanguageName = (language: string) => {
  if (!language)
    return 'Plain'

  if (language in capitalizationLanguageNameMap)
    return capitalizationLanguageNameMap[language]

  return language.charAt(0).toUpperCase() + language.substring(1)
}

// **Add code block
// Avoid error #185 (Maximum update depth exceeded.
// This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate.
// React limits the number of nested updates to prevent infinite loops.)
// Reference A: https://reactjs.org/docs/error-decoder.html?invariant=185
// Reference B1: https://react.dev/reference/react/memo
// Reference B2: https://react.dev/reference/react/useMemo
// ****
// The original error that occurred in the streaming response during the conversation:
// Error: Minified React error 185;
// visit https://reactjs.org/docs/error-decoder.html?invariant=185 for the full message
// or use the non-minified dev environment for full errors and additional helpful warnings.

const ShikiCodeBlock = memo(({ code, language, theme, initial }: { code: string, language: string, theme: BundledTheme, initial?: JSX.Element }) => {
  const [nodes, setNodes] = useState(initial)

  useLayoutEffect(() => {
    let cancelled = false

    void highlightCode({
      code,
      language: language as BundledLanguage,
      theme,
    }).then((result) => {
      if (!cancelled)
        setNodes(result)
    }).catch((error) => {
      console.error('Shiki highlighting failed:', error)
      if (!cancelled)
        setNodes(undefined)
    })

    return () => {
      cancelled = true
    }
  }, [code, language, theme])

  if (!nodes) {
    return (
      <pre style={{
        paddingLeft: 12,
        borderBottomLeftRadius: '10px',
        borderBottomRightRadius: '10px',
        backgroundColor: 'var(--color-components-input-bg-normal)',
        margin: 0,
        overflow: 'auto',
      }}
      >
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      style={{
        borderBottomLeftRadius: '10px',
        borderBottomRightRadius: '10px',
        overflow: 'auto',
      }}
      className="shiki-line-numbers [&_pre]:m-0! [&_pre]:rounded-t-none! [&_pre]:rounded-b-[10px]! [&_pre]:bg-components-input-bg-normal! [&_pre]:py-2!"
    >
      {nodes}
    </div>
  )
})
ShikiCodeBlock.displayName = 'ShikiCodeBlock'

// Define ECharts event parameter types
type EChartsEventParams = {
  type: string
  seriesIndex?: number
  dataIndex?: number
  name?: string
  value?: any
  currentIndex?: number // Added for timeline events
  [key: string]: any
}

const CodeBlock: any = memo(({ inline, className, children = '', ...props }: any) => {
  const { theme } = useTheme()
  const [isSVG, setIsSVG] = useState(true)
  const [chartState, setChartState] = useState<'loading' | 'success' | 'error'>('loading')
  const [finalChartOption, setFinalChartOption] = useState<any>(null)
  const echartsRef = useRef<any>(null)
  const contentRef = useRef<string>('')
  const processedRef = useRef<boolean>(false) // Track if content was successfully processed
  const isInitialRenderRef = useRef<boolean>(true) // Track if this is initial render
  const chartInstanceRef = useRef<any>(null) // Direct reference to ECharts instance
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // For debounce handling
  const chartReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finishedEventCountRef = useRef<number>(0) // Track finished event trigger count
  const match = /language-(\w+)/.exec(className || '')
  const language = match?.[1]
  const languageShowName = getCorrectCapitalizationLanguageName(language || '')
  const isDarkMode = theme === Theme.dark

  const clearResizeTimer = useCallback(() => {
    if (!resizeTimerRef.current)
      return

    clearTimeout(resizeTimerRef.current)
    resizeTimerRef.current = null
  }, [])

  const clearChartReadyTimer = useCallback(() => {
    if (!chartReadyTimerRef.current)
      return

    clearTimeout(chartReadyTimerRef.current)
    chartReadyTimerRef.current = null
  }, [])

  const echartsStyle = useMemo(() => ({
    height: '350px',
    width: '100%',
  }), [])

  const echartsOpts = useMemo(() => ({
    renderer: 'canvas',
    width: 'auto',
  }) as any, [])

  // Debounce resize operations
  const debouncedResize = useCallback(() => {
    clearResizeTimer()

    resizeTimerRef.current = setTimeout(() => {
      if (chartInstanceRef.current)
        chartInstanceRef.current.resize()
      resizeTimerRef.current = null
    }, 200)
  }, [clearResizeTimer])

  // Handle ECharts instance initialization
  const handleChartReady = useCallback((instance: any) => {
    chartInstanceRef.current = instance

    // Force resize to ensure timeline displays correctly
    clearChartReadyTimer()
    chartReadyTimerRef.current = setTimeout(() => {
      if (chartInstanceRef.current)
        chartInstanceRef.current.resize()
      chartReadyTimerRef.current = null
    }, 200)
  }, [clearChartReadyTimer])

  // Store event handlers in useMemo to avoid recreating them
  const echartsEvents = useMemo(() => ({
    finished: (_params: EChartsEventParams) => {
      // Limit finished event frequency to avoid infinite loops
      finishedEventCountRef.current++
      if (finishedEventCountRef.current > 3) {
        // Stop processing after 3 times to avoid infinite loops
        return
      }

      if (chartInstanceRef.current) {
        // Use debounced resize
        debouncedResize()
      }
    },
  }), [debouncedResize])

  // Handle container resize for echarts
  useEffect(() => {
    if (language !== 'echarts' || !chartInstanceRef.current)
      return

    const handleResize = () => {
      if (chartInstanceRef.current)
        // Use debounced resize
        debouncedResize()
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      clearResizeTimer()
      clearChartReadyTimer()
      chartInstanceRef.current = null
    }
  }, [language, debouncedResize, clearResizeTimer, clearChartReadyTimer])

  useEffect(() => {
    return () => {
      clearResizeTimer()
      clearChartReadyTimer()
      chartInstanceRef.current = null
      echartsRef.current = null
    }
  }, [clearResizeTimer, clearChartReadyTimer])
  // Process chart data when content changes
  useEffect(() => {
    // Only process echarts content
    if (language !== 'echarts')
      return

    // Reset state when new content is detected
    if (!contentRef.current) {
      setChartState('loading')
      processedRef.current = false
    }

    const newContent = String(children).replace(/\n$/, '')

    // Skip if content hasn't changed
    if (contentRef.current === newContent)
      return
    contentRef.current = newContent

    const trimmedContent = newContent.trim()
    if (!trimmedContent)
      return

    // Detect if this is historical data (already complete)
    // Historical data typically comes as a complete code block with complete JSON
    const isCompleteJson
      = (trimmedContent.startsWith('{') && trimmedContent.endsWith('}')
        && trimmedContent.split('{').length === trimmedContent.split('}').length)
      || (trimmedContent.startsWith('[') && trimmedContent.endsWith(']')
        && trimmedContent.split('[').length === trimmedContent.split(']').length)

    // If the JSON structure looks complete, try to parse it right away
    if (isCompleteJson && !processedRef.current) {
      try {
        const parsed = JSON.parse(trimmedContent)
        if (typeof parsed === 'object' && parsed !== null) {
          setFinalChartOption(parsed)
          setChartState('success')
          processedRef.current = true
          return
        }
      }
      catch {
        // Avoid executing arbitrary code; require valid JSON for chart options.
        setChartState('error')
        processedRef.current = true
        return
      }
    }

    // If we get here, either the JSON isn't complete yet, or we failed to parse it
    // Check more conditions for streaming data
    const isIncomplete
      = trimmedContent.length < 5
        || (trimmedContent.startsWith('{')
          && (!trimmedContent.endsWith('}')
            || trimmedContent.split('{').length !== trimmedContent.split('}').length))
          || (trimmedContent.startsWith('[')
            && (!trimmedContent.endsWith(']')
              || trimmedContent.split('[').length !== trimmedContent.split('}').length))
            || (trimmedContent.split('"').length % 2 !== 1)
            || (trimmedContent.includes('{"') && !trimmedContent.includes('"}'))

    // Only try to parse streaming data if it looks complete and hasn't been processed
    if (!isIncomplete && !processedRef.current) {
      let isValidOption = false

      try {
        const parsed = JSON.parse(trimmedContent)
        if (typeof parsed === 'object' && parsed !== null) {
          setFinalChartOption(parsed)
          isValidOption = true
        }
      }
      catch {
        // Only accept JSON to avoid executing arbitrary code from the message.
        setChartState('error')
        processedRef.current = true
      }

      if (isValidOption) {
        setChartState('success')
        processedRef.current = true
      }
    }
  }, [language, children])

  // Cache rendered content to avoid unnecessary re-renders
  const renderCodeContent = useMemo(() => {
    const content = String(children).replace(/\n$/, '')
    switch (language) {
      case 'mermaid':
        return <Flowchart PrimitiveCode={content} theme={theme as 'light' | 'dark'} />
      case 'echarts': {
        // Loading state: show loading indicator
        if (chartState === 'loading') {
          return (
            <div style={{
              minHeight: '350px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottomLeftRadius: '10px',
              borderBottomRightRadius: '10px',
              backgroundColor: isDarkMode ? 'var(--color-components-input-bg-normal)' : 'transparent',
              color: 'var(--color-text-secondary)',
            }}
            >
              <div style={{
                marginBottom: '12px',
                width: '24px',
                height: '24px',
              }}
              >
                {/* Rotating spinner that works in both light and dark modes */}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ animation: 'spin 1.5s linear infinite' }}>
                  <style>
                    {`
                      @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                      }
                    `}
                  </style>
                  <circle opacity="0.2" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 2C6.47715 2 2 6.47715 2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <div style={{
                fontFamily: 'var(--font-family)',
                fontSize: '14px',
              }}
              >
                Chart loading...
              </div>
            </div>
          )
        }

        // Success state: show the chart
        if (chartState === 'success' && finalChartOption) {
          // Reset finished event counter
          finishedEventCountRef.current = 0

          return (
            <div style={{
              minWidth: '300px',
              minHeight: '350px',
              width: '100%',
              overflowX: 'auto',
              borderBottomLeftRadius: '10px',
              borderBottomRightRadius: '10px',
              transition: 'background-color 0.3s ease',
            }}
            >
              <ErrorBoundary>
                <ReactEcharts
                  ref={(e) => {
                    if (e && isInitialRenderRef.current) {
                      echartsRef.current = e
                      isInitialRenderRef.current = false
                    }
                  }}
                  option={finalChartOption}
                  style={echartsStyle}
                  theme={isDarkMode ? 'dark' : undefined}
                  opts={echartsOpts}
                  notMerge={false}
                  lazyUpdate={false}
                  onEvents={echartsEvents}
                  onChartReady={handleChartReady}
                />
              </ErrorBoundary>
            </div>
          )
        }

        // Error state: show error message
        const errorOption = {
          title: {
            text: 'ECharts error - Wrong option.',
          },
        }

        return (
          <div style={{
            minWidth: '300px',
            minHeight: '350px',
            width: '100%',
            overflowX: 'auto',
            borderBottomLeftRadius: '10px',
            borderBottomRightRadius: '10px',
            transition: 'background-color 0.3s ease',
          }}
          >
            <ErrorBoundary>
              <ReactEcharts
                ref={echartsRef}
                option={errorOption}
                style={echartsStyle}
                theme={isDarkMode ? 'dark' : undefined}
                opts={echartsOpts}
                notMerge={true}
              />
            </ErrorBoundary>
          </div>
        )
      }
      case 'svg':
        if (isSVG) {
          return (
            <ErrorBoundary>
              <SVGRenderer content={content} />
            </ErrorBoundary>
          )
        }
        break
      case 'abc':
        return (
          <ErrorBoundary>
            <MarkdownMusic children={content} />
          </ErrorBoundary>
        )
      default:
        return (
          <ShikiCodeBlock
            code={content}
            language={match?.[1] || 'text'}
            theme={isDarkMode ? 'github-dark' : 'github-light'}
          />
        )
    }
  }, [children, language, isSVG, finalChartOption, props, theme, match, chartState, isDarkMode, echartsStyle, echartsOpts, handleChartReady, echartsEvents])

  if (inline || !match)
    return <code {...props} className={className}>{children}</code>

  return (
    <div className="relative">
      <div className="flex h-8 items-center justify-between rounded-t-[10px] border-b border-divider-subtle bg-components-input-bg-normal p-1 pl-3">
        <div className="system-xs-semibold-uppercase text-text-secondary">{languageShowName}</div>
        <div className="flex items-center gap-1">
          {language === 'svg' && <SVGBtn isSVG={isSVG} setIsSVG={setIsSVG} />}
          <ActionButton>
            <CopyIcon content={String(children).replace(/\n$/, '')} />
          </ActionButton>
        </div>
      </div>
      {renderCodeContent}
    </div>
  )
})
CodeBlock.displayName = 'CodeBlock'

export default CodeBlock
