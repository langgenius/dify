import ReactMarkdown from 'react-markdown'
import ReactEcharts from 'echarts-for-react'
import 'katex/dist/katex.min.css'
import RemarkMath from 'remark-math'
import RemarkBreaks from 'remark-breaks'
import RehypeKatex from 'rehype-katex'
import RemarkGfm from 'remark-gfm'
import SyntaxHighlighter from 'react-syntax-highlighter'
import { atelierHeathLight } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import type { RefObject } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { CodeComponent } from 'react-markdown/lib/ast-to-react'
import cn from '@/utils/classnames'
import CopyBtn from '@/app/components/base/copy-btn'
import SVGBtn from '@/app/components/base/svg'
import Flowchart from '@/app/components/base/mermaid'
import ImageGallery from '@/app/components/base/image-gallery'

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
  return content.replace(/\\\[(.*?)\\\]/g, (_, equation) => `$$${equation}$$`)
    .replace(/\\\((.*?)\\\)/g, (_, equation) => `$$${equation}$$`)
    .replace(/(^|[^\\])\$(.+?)\$/g, (_, prefix, equation) => `${prefix}$${equation}$`)
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

const useLazyLoad = (ref: RefObject<Element>): boolean => {
  const [isIntersecting, setIntersecting] = useState<boolean>(false)

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIntersecting(true)
        observer.disconnect()
      }
    })

    if (ref.current)
      observer.observe(ref.current)

    return () => {
      observer.disconnect()
    }
  }, [ref])

  return isIntersecting
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
const CodeBlock: CodeComponent = memo(({ inline, className, children, ...props }) => {
  const [isSVG, setIsSVG] = useState(true)
  const match = /language-(\w+)/.exec(className || '')
  const language = match?.[1]
  const languageShowName = getCorrectCapitalizationLanguageName(language || '')
  let chartData = JSON.parse(String('{"title":{"text":"Something went wrong."}}').replace(/\n$/, ''))
  if (language === 'echarts') {
    try {
      chartData = JSON.parse(String(children).replace(/\n$/, ''))
    }
    catch (error) {
    }
  }

  // Use `useMemo` to ensure that `SyntaxHighlighter` only re-renders when necessary
  return useMemo(() => {
    return (!inline && match)
      ? (
        <div>
          <div
            className='flex justify-between h-8 items-center p-1 pl-3 border-b'
            style={{
              borderColor: 'rgba(0, 0, 0, 0.05)',
            }}
          >
            <div className='text-[13px] text-gray-500 font-normal'>{languageShowName}</div>
            <div style={{ display: 'flex' }}>
              {language === 'mermaid'
                && <SVGBtn
                  isSVG={isSVG}
                  setIsSVG={setIsSVG}
                />
              }
              <CopyBtn
                className='mr-1'
                value={String(children).replace(/\n$/, '')}
                isPlain
              />
            </div>
          </div>
          {(language === 'mermaid' && isSVG)
            ? (<Flowchart PrimitiveCode={String(children).replace(/\n$/, '')} />)
            : (
              (language === 'echarts')
                ? (<div style={{ minHeight: '250px', minWidth: '250px' }}><ReactEcharts
                  option={chartData}
                >
                </ReactEcharts></div>)
                : (<SyntaxHighlighter
                  {...props}
                  style={atelierHeathLight}
                  customStyle={{
                    paddingLeft: 12,
                    backgroundColor: '#fff',
                  }}
                  language={match[1]}
                  showLineNumbers
                  PreTag="div"
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>))}
        </div>
      )
      : (
        <code {...props} className={className}>
          {children}
        </code>
      )
  }, [chartData, children, className, inline, isSVG, language, languageShowName, match, props])
})

CodeBlock.displayName = 'CodeBlock'

export function Markdown(props: { content: string; className?: string }) {
  const latexContent = preprocessLaTeX(props.content)
  return (
    <div className={cn(props.className, 'markdown-body')}>
      <ReactMarkdown
        remarkPlugins={[[RemarkMath, { singleDollarTextMath: false }], RemarkGfm, RemarkBreaks]}
        rehypePlugins={[
          RehypeKatex as any,
        ]}
        components={{
          code: CodeBlock,
          img({ src }) {
            return (
              <ImageGallery srcs={[src || '']} />
            )
          },
          p: (paragraph) => {
            const { node }: any = paragraph
            if (node.children[0].tagName === 'img') {
              const image = node.children[0]

              return (
                <>
                  <ImageGallery srcs={[image.properties.src]} />
                  <p>{paragraph.children.slice(1)}</p>
                </>
              )
            }
            return <p>{paragraph.children}</p>
          },
        }}
        linkTarget='_blank'
      >
        {/* Markdown detect has problem. */}
        {latexContent}
      </ReactMarkdown>
    </div>
  )
}
