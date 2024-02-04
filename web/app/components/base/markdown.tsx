import ReactMarkdown from 'react-markdown'
import 'katex/dist/katex.min.css'
import RemarkMath from 'remark-math'
import RemarkBreaks from 'remark-breaks'
import RehypeKatex from 'rehype-katex'
import RemarkGfm from 'remark-gfm'
import SyntaxHighlighter from 'react-syntax-highlighter'
import { atelierHeathLight } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import cn from 'classnames'
import CopyBtn from '@/app/components/app/chat/copy-btn'
import SVGBtn from '@/app/components/app/chat/svg'
import Flowchart from '@/app/components/app/chat/mermaid'
import s from '@/app/components/app/chat/style.module.css'

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
}
const getCorrectCapitalizationLanguageName = (language: string) => {
  if (!language)
    return 'Plain'

  if (language in capitalizationLanguageNameMap)
    return capitalizationLanguageNameMap[language]

  return language.charAt(0).toUpperCase() + language.substring(1)
}
export function PreCode(props: { children: any }) {
  const ref = useRef<HTMLPreElement>(null)

  return (
    <pre ref={ref}>
      <span
        className="copy-code-button"
        onClick={() => {
          if (ref.current) {
            const code = ref.current.innerText
            // copyToClipboard(code);
          }
        }}
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

export function Markdown(props: { content: string; className?: string }) {
  const [isCopied, setIsCopied] = useState(false)
  const [isSVG, setIsSVG] = useState(false)
  return (
    <div className={cn(props.className, 'markdown-body')}>
      <ReactMarkdown
        remarkPlugins={[[RemarkMath, { singleDollarTextMath: false }], RemarkGfm, RemarkBreaks]}
        rehypePlugins={[
          RehypeKatex,
        ]}
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const language = match?.[1]
            const languageShowName = getCorrectCapitalizationLanguageName(language || '')
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
                        className={cn(s.copyBtn, 'mr-1')}
                        value={String(children).replace(/\n$/, '')}
                        isPlain
                      />
                    </div>
                  </div>
                  {(language === 'mermaid' && isSVG)
                    ? (<Flowchart PrimitiveCode={String(children).replace(/\n$/, '')} />)
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
                    </SyntaxHighlighter>)}
                </div>
              )
              : (
                <code {...props} className={className}>
                  {children}
                </code>
              )
          },
        }}
        linkTarget='_blank'
      >
        {/* Markdown detect has problem. */}
        {props.content}
      </ReactMarkdown>
    </div>
  )
}
