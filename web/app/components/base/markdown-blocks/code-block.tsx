import type { JSX } from 'react'
import type { BundledTheme } from 'shiki/bundle/web'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Toggle } from '@langgenius/dify-ui/toggle'
import { memo, useLayoutEffect, useMemo, useState } from 'react'
import CopyIcon from '@/app/components/base/copy-icon'
import ErrorBoundary from '@/app/components/base/markdown/error-boundary'
import useTheme from '@/hooks/use-theme'
import dynamic from '@/next/dynamic'
import { Theme } from '@/types/app'
import SVGRenderer from '../svg-gallery' // Assumes svg-gallery.tsx is in /base directory
import { highlightCode } from './shiki-highlight'

const Flowchart = dynamic(() => import('@/app/components/base/mermaid'), { ssr: false })
const EChartsCodeBlock = dynamic(
  () =>
    import('@/app/components/base/markdown-blocks/echarts-code-block').then((mod) => ({
      default: mod.EChartsCodeBlock,
    })),
  { ssr: false },
)
const MarkdownMusic = dynamic(() => import('@/app/components/base/markdown-blocks/music'), {
  ssr: false,
})

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
  }: {
    code: string
    language: string
    theme: BundledTheme
    initial?: JSX.Element
  }) => {
    const [nodes, setNodes] = useState(initial)

    useLayoutEffect(() => {
      let cancelled = false

      void highlightCode({
        code,
        language,
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
    }, [code, language, theme])

    if (!nodes) {
      return (
        <pre
          style={{
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
  },
)
ShikiCodeBlock.displayName = 'ShikiCodeBlock'

// oxlint-disable-next-line typescript/no-explicit-any -- Markdown code component accepts heterogeneous react-markdown props.
export const CodeBlock: any = memo(({ inline, className, children = '', ...props }: any) => {
  const { theme } = useTheme()
  const [isSVG, setIsSVG] = useState(true)
  const match = /language-(\w+)/.exec(className || '')
  const language = match?.[1]
  const languageShowName = getCorrectCapitalizationLanguageName(language || '')
  const isDarkMode = theme === Theme.dark

  // Cache rendered content to avoid unnecessary re-renders
  const renderCodeContent = useMemo(() => {
    const content = String(children).replace(/\n$/, '')
    switch (language) {
      case 'mermaid':
        return <Flowchart PrimitiveCode={content} theme={theme as 'light' | 'dark'} />
      case 'echarts':
        return <EChartsCodeBlock isDarkMode={isDarkMode}>{content}</EChartsCodeBlock>
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
            language={match?.[1] || 'text'}
            theme={isDarkMode ? 'github-dark' : 'github-light'}
          />
        )
    }
  }, [children, language, isSVG, theme, match, isDarkMode])

  if (inline || !match)
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
          {language === 'svg' && (
            <Toggle
              pressed={isSVG}
              onPressedChange={setIsSVG}
              render={
                <IconButton aria-label="SVG">
                  <span
                    aria-hidden
                    className={isSVG ? 'i-ri-file-code-fill size-4' : 'i-ri-file-code-line size-4'}
                  />
                </IconButton>
              }
            />
          )}
          <CopyIcon content={String(children).replace(/\n$/, '')} />
        </div>
      </div>
      {renderCodeContent}
    </div>
  )
})
CodeBlock.displayName = 'CodeBlock'
