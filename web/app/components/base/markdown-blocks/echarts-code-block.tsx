import type { ComponentRef } from 'react'
import ReactEcharts from 'echarts-for-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ErrorBoundary from '@/app/components/base/markdown/error-boundary'

type EChartsEventParams = {
  type: string
  seriesIndex?: number
  dataIndex?: number
  name?: string
  value?: unknown
  currentIndex?: number
  [key: string]: unknown
}

type EChartsInstance = {
  resize: () => void
}

export const EChartsCodeBlock = memo(
  ({ children, isDarkMode }: { children: React.ReactNode; isDarkMode: boolean }) => {
    const [chartState, setChartState] = useState<'loading' | 'success' | 'error'>('loading')
    const [finalChartOption, setFinalChartOption] = useState<Record<string, unknown> | null>(null)
    const echartsRef = useRef<ComponentRef<typeof ReactEcharts> | null>(null)
    const contentRef = useRef<string>('')
    const processedRef = useRef<boolean>(false)
    const isInitialRenderRef = useRef<boolean>(true)
    const chartInstanceRef = useRef<EChartsInstance | null>(null)
    const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const chartReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const finishedEventCountRef = useRef<number>(0)

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
      () => ({
        renderer: 'canvas' as const,
        width: 'auto' as const,
      }),
      [],
    )

    const debouncedResize = useCallback(() => {
      clearResizeTimer()

      resizeTimerRef.current = setTimeout(() => {
        if (chartInstanceRef.current) chartInstanceRef.current.resize()
        resizeTimerRef.current = null
      }, 200)
    }, [clearResizeTimer])

    const handleChartReady = useCallback(
      (instance: EChartsInstance) => {
        chartInstanceRef.current = instance

        clearChartReadyTimer()
        chartReadyTimerRef.current = setTimeout(() => {
          if (chartInstanceRef.current) chartInstanceRef.current.resize()
          chartReadyTimerRef.current = null
        }, 200)
      },
      [clearChartReadyTimer],
    )

    const echartsEvents = useMemo(
      () => ({
        finished: (_params: EChartsEventParams) => {
          finishedEventCountRef.current++
          if (finishedEventCountRef.current > 3) {
            return
          }

          if (chartInstanceRef.current) {
            debouncedResize()
          }
        },
      }),
      [debouncedResize],
    )

    useEffect(() => {
      if (!chartInstanceRef.current) return

      const handleResize = () => {
        if (chartInstanceRef.current) debouncedResize()
      }

      window.addEventListener('resize', handleResize)

      return () => {
        window.removeEventListener('resize', handleResize)
        clearResizeTimer()
        clearChartReadyTimer()
        chartInstanceRef.current = null
      }
    }, [debouncedResize, clearResizeTimer, clearChartReadyTimer])

    useEffect(() => {
      return () => {
        clearResizeTimer()
        clearChartReadyTimer()
        chartInstanceRef.current = null
        echartsRef.current = null
      }
    }, [clearResizeTimer, clearChartReadyTimer])

    useEffect(() => {
      if (!contentRef.current) {
        setChartState('loading')
        processedRef.current = false
      }

      const newContent = String(children).replace(/\n$/, '')

      if (contentRef.current === newContent) return
      contentRef.current = newContent

      const trimmedContent = newContent.trim()
      if (!trimmedContent) return

      const isCompleteJson =
        (trimmedContent.startsWith('{') &&
          trimmedContent.endsWith('}') &&
          trimmedContent.split('{').length === trimmedContent.split('}').length) ||
        (trimmedContent.startsWith('[') &&
          trimmedContent.endsWith(']') &&
          trimmedContent.split('[').length === trimmedContent.split(']').length)

      if (isCompleteJson && !processedRef.current) {
        try {
          const parsed = JSON.parse(trimmedContent)
          if (typeof parsed === 'object' && parsed !== null) {
            setFinalChartOption(parsed)
            finishedEventCountRef.current = 0
            setChartState('success')
            processedRef.current = true
            return
          }
        } catch {
          setChartState('error')
          processedRef.current = true
          return
        }
      }

      const isIncomplete =
        trimmedContent.length < 5 ||
        (trimmedContent.startsWith('{') &&
          (!trimmedContent.endsWith('}') ||
            trimmedContent.split('{').length !== trimmedContent.split('}').length)) ||
        (trimmedContent.startsWith('[') &&
          (!trimmedContent.endsWith(']') ||
            trimmedContent.split('[').length !== trimmedContent.split('}').length)) ||
        trimmedContent.split('"').length % 2 !== 1 ||
        (trimmedContent.includes('{"') && !trimmedContent.includes('"}'))

      if (!isIncomplete && !processedRef.current) {
        let isValidOption = false

        try {
          const parsed = JSON.parse(trimmedContent)
          if (typeof parsed === 'object' && parsed !== null) {
            setFinalChartOption(parsed)
            isValidOption = true
          }
        } catch {
          setChartState('error')
          processedRef.current = true
        }

        if (isValidOption) {
          finishedEventCountRef.current = 0
          setChartState('success')
          processedRef.current = true
        }
      }
    }, [children])

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
            backgroundColor: isDarkMode ? 'var(--color-components-input-bg-normal)' : 'transparent',
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
              <circle opacity="0.2" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
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

    if (chartState === 'success' && finalChartOption) {
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
  },
)
EChartsCodeBlock.displayName = 'EChartsCodeBlock'
