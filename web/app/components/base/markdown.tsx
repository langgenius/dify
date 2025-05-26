import ReactMarkdown from 'react-markdown'
import ReactEcharts from 'echarts-for-react'
import 'katex/dist/katex.min.css'
import RemarkMath from 'remark-math'
import RemarkBreaks from 'remark-breaks'
import RehypeKatex from 'rehype-katex'
import RemarkGfm from 'remark-gfm'
import RehypeRaw from 'rehype-raw'
import SyntaxHighlighter from 'react-syntax-highlighter'
import {
  atelierHeathDark,
  atelierHeathLight,
} from 'react-syntax-highlighter/dist/esm/styles/hljs'
import { Component, memo, useEffect, useMemo, useRef, useState } from 'react'
import { flow } from 'lodash-es'
import ActionButton from '@/app/components/base/action-button'
import CopyIcon from '@/app/components/base/copy-icon'
import SVGBtn from '@/app/components/base/svg'
import Flowchart from '@/app/components/base/mermaid'
import ImageGallery from '@/app/components/base/image-gallery'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import VideoGallery from '@/app/components/base/video-gallery'
import AudioGallery from '@/app/components/base/audio-gallery'
import MarkdownButton from '@/app/components/base/markdown-blocks/button'
import MarkdownForm from '@/app/components/base/markdown-blocks/form'
import MarkdownMusic from '@/app/components/base/markdown-blocks/music'
import ThinkBlock from '@/app/components/base/markdown-blocks/think-block'
import { Theme } from '@/types/app'
import useTheme from '@/hooks/use-theme'
import cn from '@/utils/classnames'
import SVGRenderer from './svg-gallery'

// Available language https://github.com/react-syntax-highlighter/react-syntax-highlighter/blob/master/AVAILABLE_LANGUAGES_HLJS.MD
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

const preprocessLaTeX = (content: string) => {
  if (typeof content !== 'string')
    return content

  const codeBlockRegex = /```[\s\S]*?```/g
  const codeBlocks = content.match(codeBlockRegex) || []
  let processedContent = content.replace(codeBlockRegex, 'CODE_BLOCK_PLACEHOLDER')

  processedContent = flow([
    (str: string) => str.replace(/\\\[(.*?)\\\]/g, (_, equation) => `$$${equation}$$`),
    (str: string) => str.replace(/\\\[([\s\S]*?)\\\]/g, (_, equation) => `$$${equation}$$`),
    (str: string) => str.replace(/\\\((.*?)\\\)/g, (_, equation) => `$$${equation}$$`),
    (str: string) => str.replace(/(^|[^\\])\$(.+?)\$/g, (_, prefix, equation) => `${prefix}$${equation}$`),
  ])(processedContent)

  codeBlocks.forEach((block) => {
    processedContent = processedContent.replace('CODE_BLOCK_PLACEHOLDER', block)
  })

  return processedContent
}

const preprocessThinkTag = (content: string) => {
  const thinkOpenTagRegex = /<think>\n/g
  const thinkCloseTagRegex = /\n<\/think>/g
  return flow([
    (str: string) => str.replace(thinkOpenTagRegex, '<details data-think=true>\n'),
    (str: string) => str.replace(thinkCloseTagRegex, '\n[ENDTHINKFLAG]</details>'),
  ])(content)
}

export function PreCode(props: { children: any }) {
  const ref = useRef<HTMLPreElement>(null)

  return (
    <pre ref={ref}>
      <span
        className="copy-code-button"
      ></span>
      {props.children}
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

const CodeBlock: any = memo(({ inline, className, children = '', ...props }: any) => {
  const { theme } = useTheme()
  const [isSVG, setIsSVG] = useState(true)
  const [chartState, setChartState] = useState<'loading' | 'success' | 'error'>('loading')
  const [finalChartOption, setFinalChartOption] = useState<any>(null)
  const echartsRef = useRef<any>(null)
  const contentRef = useRef<string>('')
  const processedRef = useRef<boolean>(false) // Track if content was successfully processed
  const match = /language-(\w+)/.exec(className || '')
  const language = match?.[1]
  const languageShowName = getCorrectCapitalizationLanguageName(language || '')
  const isDarkMode = theme === Theme.dark

  const echartsStyle = useMemo(() => ({
    height: '350px',
    width: '100%',
  }), [])

  const echartsOpts = useMemo(() => ({
    renderer: 'canvas',
    width: 'auto',
  }) as any, [])

  const echartsOnEvents = useMemo(() => ({
    finished: () => {
      const instance = echartsRef.current?.getEchartsInstance?.()
      if (instance)
        instance.resize()
    },
  }), [echartsRef]) // echartsRef is stable, so this effectively runs once.

  // Handle container resize for echarts
  useEffect(() => {
    if (language !== 'echarts' || !echartsRef.current) return

    const handleResize = () => {
      // This gets the echarts instance from the component
      const instance = echartsRef.current?.getEchartsInstance?.()
      if (instance)
        instance.resize()
    }

    window.addEventListener('resize', handleResize)

    // Also manually trigger resize after a short delay to ensure proper sizing
    const resizeTimer = setTimeout(handleResize, 200)

    return () => {
      window.removeEventListener('resize', handleResize)
      clearTimeout(resizeTimer)
    }
  }, [language, echartsRef.current])

  // Process chart data when content changes
  useEffect(() => {
    // Only process echarts content
    if (language !== 'echarts') return

    // Reset state when new content is detected
    if (!contentRef.current) {
      setChartState('loading')
      processedRef.current = false
    }

    const newContent = String(children).replace(/\n$/, '')

    // Skip if content hasn't changed
    if (contentRef.current === newContent) return
    contentRef.current = newContent

    const trimmedContent = newContent.trim()
    if (!trimmedContent) return

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
        try {
          // eslint-disable-next-line no-new-func, sonarjs/code-eval
          const result = new Function(`return ${trimmedContent}`)()
          if (typeof result === 'object' && result !== null) {
            setFinalChartOption(result)
            setChartState('success')
            processedRef.current = true
            return
          }
        }
        catch {
          // If we have a complete JSON structure but it doesn't parse,
          // it's likely an error rather than incomplete data
          setChartState('error')
          processedRef.current = true
          return
        }
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
        try {
          // eslint-disable-next-line no-new-func, sonarjs/code-eval
          const result = new Function(`return ${trimmedContent}`)()
          if (typeof result === 'object' && result !== null) {
            setFinalChartOption(result)
            isValidOption = true
          }
        }
        catch {
          // Both parsing methods failed, but content looks complete
          setChartState('error')
          processedRef.current = true
        }
      }

      if (isValidOption) {
        setChartState('success')
        processedRef.current = true
      }
    }
  }, [language, children])

  const renderCodeContent = useMemo(() => {
    const content = String(children).replace(/\n$/, '')
    switch (language) {
      case 'mermaid':
        if (isSVG)
          return <Flowchart PrimitiveCode={content} />
        break
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
            }}>
              <div style={{
                marginBottom: '12px',
                width: '24px',
                height: '24px',
              }}>
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
              }}>Chart loading...</div>
            </div>
          )
        }

        // Success state: show the chart
        if (chartState === 'success' && finalChartOption) {
          return (
            <div style={{
              minWidth: '300px',
              minHeight: '350px',
              width: '100%',
              overflowX: 'auto',
              borderBottomLeftRadius: '10px',
              borderBottomRightRadius: '10px',
              transition: 'background-color 0.3s ease',
            }}>
              <ErrorBoundary>
                <ReactEcharts
                  ref={echartsRef}
                  option={finalChartOption}
                  style={echartsStyle}
                  theme={isDarkMode ? 'dark' : undefined}
                  opts={echartsOpts}
                  notMerge={true}
                  onEvents={echartsOnEvents}
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
          }}>
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
          <SyntaxHighlighter
            {...props}
            style={theme === Theme.light ? atelierHeathLight : atelierHeathDark}
            customStyle={{
              paddingLeft: 12,
              borderBottomLeftRadius: '10px',
              borderBottomRightRadius: '10px',
              backgroundColor: 'var(--color-components-input-bg-normal)',
            }}
            language={match?.[1]}
            showLineNumbers
            PreTag="div"
          >
            {content}
          </SyntaxHighlighter>
        )
    }
  }, [children, language, isSVG, finalChartOption, props, theme, match, chartState, isDarkMode, echartsStyle, echartsOpts, echartsOnEvents])

  if (inline || !match)
    return <code {...props} className={className}>{children}</code>

  return (
    <div className='relative'>
      <div className='flex h-8 items-center justify-between rounded-t-[10px] border-b border-divider-subtle bg-components-input-bg-normal p-1 pl-3'>
        <div className='system-xs-semibold-uppercase text-text-secondary'>{languageShowName}</div>
        <div className='flex items-center gap-1'>
          {(['mermaid', 'svg']).includes(language!) && <SVGBtn isSVG={isSVG} setIsSVG={setIsSVG} />}
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

const VideoBlock: any = memo(({ node }: any) => {
  const srcs = node.children.filter((child: any) => 'properties' in child).map((child: any) => (child as any).properties.src)
  if (srcs.length === 0) {
    const src = node.properties?.src
    if (src)
      return <VideoGallery key={src} srcs={[src]} />
    return null
  }
  return <VideoGallery key={srcs.join()} srcs={srcs} />
})
VideoBlock.displayName = 'VideoBlock'

const AudioBlock: any = memo(({ node }: any) => {
  const srcs = node.children.filter((child: any) => 'properties' in child).map((child: any) => (child as any).properties.src)
  if (srcs.length === 0) {
    const src = node.properties?.src
    if (src)
      return <AudioGallery key={src} srcs={[src]} />
    return null
  }
  return <AudioGallery key={srcs.join()} srcs={srcs} />
})
AudioBlock.displayName = 'AudioBlock'

const ScriptBlock = memo(({ node }: any) => {
  const scriptContent = node.children[0]?.value || ''
  return `<script>${scriptContent}</script>`
})
ScriptBlock.displayName = 'ScriptBlock'

const Paragraph = (paragraph: any) => {
  const { node }: any = paragraph
  const children_node = node.children
  if (children_node && children_node[0] && 'tagName' in children_node[0] && children_node[0].tagName === 'img') {
    return (
      <div className="markdown-img-wrapper">
        <ImageGallery srcs={[children_node[0].properties.src]} />
        {
          Array.isArray(paragraph.children) && paragraph.children.length > 1 && (
            <div className="mt-2">{paragraph.children.slice(1)}</div>
          )
        }
      </div>
    )
  }
  return <p>{paragraph.children}</p>
}

const Img = ({ src }: any) => {
  return <div className="markdown-img-wrapper"><ImageGallery srcs={[src]} /></div>
}

const Link = ({ node, children, ...props }: any) => {
  if (node.properties?.href && node.properties.href?.toString().startsWith('abbr')) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { onSend } = useChatContext()
    const hidden_text = decodeURIComponent(node.properties.href.toString().split('abbr:')[1])

    return <abbr className="cursor-pointer underline !decoration-primary-700 decoration-dashed" onClick={() => onSend?.(hidden_text)} title={node.children[0]?.value || ''}>{node.children[0]?.value || ''}</abbr>
  }
  else {
    return <a {...props} target="_blank" className="cursor-pointer underline !decoration-primary-700 decoration-dashed">{children || 'Download'}</a>
  }
}

export function Markdown(props: { content: string; className?: string; customDisallowedElements?: string[] }) {
  const latexContent = flow([
    preprocessThinkTag,
    preprocessLaTeX,
  ])(props.content)

  return (
    <div className={cn('markdown-body', '!text-text-primary', props.className)}>
      <ReactMarkdown
        remarkPlugins={[
          RemarkGfm,
          [RemarkMath, { singleDollarTextMath: false }],
          RemarkBreaks,
        ]}
        rehypePlugins={[
          RehypeKatex,
          RehypeRaw as any,
          // The Rehype plug-in is used to remove the ref attribute of an element
          () => {
            return (tree) => {
              const iterate = (node: any) => {
                if (node.type === 'element' && node.properties?.ref)
                  delete node.properties.ref

                if (node.type === 'element' && !/^[a-z][a-z0-9]*$/i.test(node.tagName)) {
                  node.type = 'text'
                  node.value = `<${node.tagName}`
                }

                if (node.children)
                  node.children.forEach(iterate)
              }
              tree.children.forEach(iterate)
            }
          },
        ]}
        disallowedElements={['iframe', 'head', 'html', 'meta', 'link', 'style', 'body', ...(props.customDisallowedElements || [])]}
        components={{
          code: CodeBlock,
          img: Img,
          video: VideoBlock,
          audio: AudioBlock,
          a: Link,
          p: Paragraph,
          button: MarkdownButton,
          form: MarkdownForm,
          script: ScriptBlock as any,
          details: ThinkBlock,
        }}
      >
        {/* Markdown detect has problem. */}
        {latexContent}
      </ReactMarkdown>
    </div>
  )
}

// **Add an ECharts runtime error handler
// Avoid error #7832 (Crash when ECharts accesses undefined objects)
// This can happen when a component attempts to access an undefined object that references an unregistered map, causing the program to crash.

export default class ErrorBoundary extends Component {
  constructor(props: any) {
    super(props)
    this.state = { hasError: false }
  }

  componentDidCatch(error: any, errorInfo: any) {
    this.setState({ hasError: true })
    console.error(error, errorInfo)
  }

  render() {
    // eslint-disable-next-line ts/ban-ts-comment
    // @ts-expect-error
    if (this.state.hasError)
      return <div>Oops! An error occurred. This could be due to an ECharts runtime error or invalid SVG content. <br />(see the browser console for more information)</div>
    // eslint-disable-next-line ts/ban-ts-comment
    // @ts-expect-error
    return this.props.children
  }
}
