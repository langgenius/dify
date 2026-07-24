import type { EChartsOption } from 'echarts'
import type { JSX } from 'react'
import type { BundledLanguage, BundledTheme } from 'shiki/bundle/web'
import { useThrottle } from 'ahooks'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsCodeFenceIncomplete } from 'streamdown'
import CopyIcon from '@/app/components/base/copy-icon'
import ErrorBoundary from '@/app/components/base/markdown/error-boundary'
import SVGBtn from '@/app/components/base/svg'
import useTheme from '@/hooks/use-theme'
import dynamic from '@/next/dynamic'
import { Theme } from '@/types/app'
import { highlightCode } from './shiki-highlight'

const Flowchart = dynamic(() => import('@/app/components/base/mermaid'), { ssr: false })
const ReactEcharts = dynamic(() => import('echarts-for-react'), { ssr: false })
const MarkdownMusic = dynamic(() => import('@/app/components/base/markdown-blocks/music'), {
  ssr: false,
})
const SVGRenderer = dynamic(() => import('../svg-gallery'), { ssr: false })

const STREAMING_HIGHLIGHT_THROTTLE_OPTIONS = {
  wait: 200,
  leading: true,
  trailing: true,
} as const

const DEFER_UNTIL_FENCE_COMPLETE = new Set(['mermaid', 'echarts', 'svg', 'abc'])

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
  if (!language) return 'Plain'

  if (language in capitalizationLanguageNameMap) return capitalizationLanguageNameMap[language]

  return language.charAt(0).toUpperCase() + language.substring(1)
}

const plainCodeStyle = {
  paddingLeft: 12,
  borderBottomLeftRadius: '10px',
  borderBottomRightRadius: '10px',
  backgroundColor: 'var(--color-components-input-bg-normal)',
  margin: 0,
  overflow: 'auto',
} as const

function PlainCodeBlock({ code }: { code: string }) {
  return (
    <pre style={plainCodeStyle}>
      <code>{code}</code>
    </pre>
  )
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

const ShikiCodeBlock = memo(
  ({
    code,
    language,
    theme,
    initial,
    isStreaming,
  }: {
    code: string
    language: string
    theme: BundledTheme
    initial?: JSX.Element
    isStreaming: boolean
  }) => {
    const [nodes, setNodes] = useState(initial)
    const throttledCode = useThrottle(code, STREAMING_HIGHLIGHT_THROTTLE_OPTIONS)
    const codeToHighlight = isStreaming ? throttledCode : code

    useEffect(() => {
      let cancelled = false

      void highlightCode({
        code: codeToHighlight,
        language: language as BundledLanguage,
        theme,
      })
        .then((result) => {
          if (!cancelled) setNodes(result)
        })
        .catch((error) => {
          console.error('Shiki highlighting failed:', error)
          if (!cancelled) setNodes(undefined)
        })

      return () => {
        cancelled = true
      }
    }, [codeToHighlight, language, theme])

    if (!nodes) return <PlainCodeBlock code={code} />

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
  },
)
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

type EChartsRenderResult = {
  chartState: 'loading' | 'success' | 'error'
  finalChartOption: EChartsOption | null
}

const ECHARTS_LOADING_RESULT: EChartsRenderResult = {
  chartState: 'loading',
  finalChartOption: null,
}

const ECHARTS_ERROR_RESULT: EChartsRenderResult = {
  chartState: 'error',
  finalChartOption: null,
}

function parseEChartsContent(content: string): EChartsRenderResult {
  const trimmedContent = content.trim()
  if (!trimmedContent) return ECHARTS_LOADING_RESULT

  const isCompleteJson =
    (trimmedContent.startsWith('{') &&
      trimmedContent.endsWith('}') &&
      trimmedContent.split('{').length === trimmedContent.split('}').length) ||
    (trimmedContent.startsWith('[') &&
      trimmedContent.endsWith(']') &&
      trimmedContent.split('[').length === trimmedContent.split(']').length)

  if (isCompleteJson) {
    try {
      const parsed: unknown = JSON.parse(trimmedContent)
      if (typeof parsed === 'object' && parsed !== null)
        return { chartState: 'success', finalChartOption: parsed as EChartsOption }

      return ECHARTS_LOADING_RESULT
    } catch {
      return ECHARTS_ERROR_RESULT
    }
  }

  const isIncomplete =
    trimmedContent.length < 5 ||
    (trimmedContent.startsWith('{') &&
      (!trimmedContent.endsWith('}') ||
        trimmedContent.split('{').length !== trimmedContent.split('}').length)) ||
    (trimmedContent.startsWith('[') &&
      (!trimmedContent.endsWith(']') ||
        trimmedContent.split('[').length !== trimmedContent.split(']').length)) ||
    trimmedContent.split('"').length % 2 !== 1 ||
    (trimmedContent.includes('{"') && !trimmedContent.includes('"}'))

  if (isIncomplete) return ECHARTS_LOADING_RESULT

  try {
    const parsed: unknown = JSON.parse(trimmedContent)
    if (typeof parsed === 'object' && parsed !== null)
      return { chartState: 'success', finalChartOption: parsed as EChartsOption }

    return ECHARTS_LOADING_RESULT
  } catch {
    return ECHARTS_ERROR_RESULT
  }
}

const CodeBlock: any = memo((codeBlockProps: any) => {
  const {
    inline,
    className,
    children = '',
    node: _node,
    'data-block': dataBlock,
    ...props
  } = codeBlockProps
  const isCodeFenceIncomplete = useIsCodeFenceIncomplete()
  const { theme } = useTheme()
  const [isSVG, setIsSVG] = useState(true)
  const chartInstanceRef = useRef<any>(null) // Direct reference to ECharts instance
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // For debounce handling
  const chartReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finishedEventCountRef = useRef<number>(0) // Track finished event trigger count
  const match = /language-(\w+)/.exec(className || '')
  const language = match?.[1]
  const languageShowName = getCorrectCapitalizationLanguageName(language || '')
  const isDarkMode = theme === Theme.dark
  const { chartState, finalChartOption } = useMemo(
    () =>
      language === 'echarts' && !isCodeFenceIncomplete
        ? parseEChartsContent(String(children).replace(/\n$/, ''))
        : ECHARTS_LOADING_RESULT,
    [children, isCodeFenceIncomplete, language],
  )

  const clearResizeTimer = useCallback(() => {
    if (!resizeTimerRef.current) return

    clearTimeout(resizeTimerRef.current)
    resizeTimerRef.current = null
  }, [])

  const clearChartReadyTimer = useCallback(() => {
    if (!chartReadyTimerRef.current) return

    clearTimeout(chartReadyTimerRef.current)
    chartReadyTimerRef.current = null
  }, [])

  const echartsStyle = useMemo(
    () => ({
      height: '350px',
      width: '100%',
    }),
    [],
  )

  const echartsOpts = useMemo(
    () =>
      ({
        renderer: 'canvas',
        width: 'auto',
      }) as any,
    [],
  )

  // Debounce resize operations
  const debouncedResize = useCallback(() => {
    clearResizeTimer()

    resizeTimerRef.current = setTimeout(() => {
      if (chartInstanceRef.current) chartInstanceRef.current.resize()
      resizeTimerRef.current = null
    }, 200)
  }, [clearResizeTimer])

  // Handle ECharts instance initialization
  const handleChartReady = useCallback(
    (instance: any) => {
      chartInstanceRef.current = instance

      // Force resize to ensure timeline displays correctly
      clearChartReadyTimer()
      chartReadyTimerRef.current = setTimeout(() => {
        if (chartInstanceRef.current) chartInstanceRef.current.resize()
        chartReadyTimerRef.current = null
      }, 200)
    },
    [clearChartReadyTimer],
  )

  // Store event handlers in useMemo to avoid recreating them
  const echartsEvents = useMemo(
    () => ({
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
    }),
    [debouncedResize],
  )

  // Handle container resize for echarts
  useEffect(() => {
    if (language !== 'echarts') return

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
    }
  }, [clearResizeTimer, clearChartReadyTimer])
  // Cache rendered content to avoid unnecessary re-renders
  const renderCodeContent = useMemo(() => {
    const content = String(children).replace(/\n$/, '')
    if (isCodeFenceIncomplete && DEFER_UNTIL_FENCE_COMPLETE.has(language || ''))
      return <PlainCodeBlock code={content} />

    switch (language) {
      case 'mermaid':
        return <Flowchart PrimitiveCode={content} theme={theme as 'light' | 'dark'} />
      case 'echarts': {
        // Loading state: show loading indicator
        if (chartState === 'loading') {
          return (
            <div
              style={{
                minHeight: '350px',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderBottomLeftRadius: '10px',
                borderBottomRightRadius: '10px',
                backgroundColor: isDarkMode
                  ? 'var(--color-components-input-bg-normal)'
                  : 'transparent',
                color: 'var(--color-text-secondary)',
              }}
            >
              <div
                style={{
                  marginBottom: '12px',
                  width: '24px',
                  height: '24px',
                }}
              >
                {/* Rotating spinner that works in both light and dark modes */}
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ animation: 'spin 1.5s linear infinite' }}
                >
                  <style>
                    {`
                      @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                      }
                    `}
                  </style>
                  <circle
                    opacity="0.2"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M12 2C6.47715 2 2 6.47715 2 12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div
                style={{
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
            <div
              style={{
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
          <div
            style={{
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
            <MarkdownMusic>{content}</MarkdownMusic>
          </ErrorBoundary>
        )
      default:
        return (
          <ShikiCodeBlock
            code={content}
            isStreaming={isCodeFenceIncomplete}
            language={language || 'text'}
            theme={isDarkMode ? 'github-dark' : 'github-light'}
          />
        )
    }
  }, [
    children,
    isCodeFenceIncomplete,
    language,
    isSVG,
    finalChartOption,
    theme,
    chartState,
    isDarkMode,
    echartsStyle,
    echartsOpts,
    handleChartReady,
    echartsEvents,
  ])

  if (inline || (!match && dataBlock === undefined))
    return (
      <code {...props} className={className}>
        {children}
      </code>
    )

  return (
    <div className="relative">
      <div className="flex h-8 items-center justify-between rounded-t-[10px] border-b border-divider-subtle bg-components-input-bg-normal p-1 pl-3">
        <div className="system-xs-semibold-uppercase text-text-secondary">{languageShowName}</div>
        <div className="flex items-center gap-1">
          {language === 'svg' && <SVGBtn isSVG={isSVG} setIsSVG={setIsSVG} />}
          <CopyIcon
            className="m-0 size-7 items-center justify-center rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            content={String(children).replace(/\n$/, '')}
          />
        </div>
      </div>
      {renderCodeContent}
    </div>
  )
})
CodeBlock.displayName = 'CodeBlock'

export default CodeBlock
