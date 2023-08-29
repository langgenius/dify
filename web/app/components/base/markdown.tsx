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
import copy from 'copy-to-clipboard'

// import { copyToClipboard } from "../utils";
// https://txtfiddle.com/~hlshwya/extract-urls-from-text
// const urlRegex = /\b((https?|ftp|file):\/\/|(www|ftp)\.)[-A-Z0-9+&@#\/%?=~_|$!:,.;]*[A-Z0-9+&@#\/%=~_|$]/ig

// function highlightURL(content: string) {
//   return content.replace(urlRegex, (url) => {
//     // fix http:// in [] will be parsed to link agin
//     const res = `[${url.replace('://', ':&#47;&#47;')}](${url})`
//     return res
//   })
// }
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

export function Markdown(props: { content: string }) {
  const [isCopied, setIsCopied] = useState(false)
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[RemarkMath, RemarkGfm, RemarkBreaks]}
        rehypePlugins={[
          RehypeKatex,
        ]}
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            return (!inline && match)
              ? (
                <div>
                  <div
                    className={'box-border p-0.5 flex items-center justify-center rounded-md bg-white cursor-pointer'}
                    style={{
                      boxShadow: '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)',
                    }}
                    onClick={() => {
                      copy(String(children).replace(/\n$/, ''))
                      setIsCopied(true)
                    }}
                  >
                    <div className={'w-6 h-6 hover:bg-gray-50'}>复制</div>
                  </div>
                  <SyntaxHighlighter
                    {...props}
                    style={atelierHeathLight}
                    language={match[1]}
                    showLineNumbers
                    PreTag="div"
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                </div>

              )
              : (
                <code {...props} className={className}>
                  {children}
                </code>
              )
          },
        }}
        linkTarget={'_blank'}
      >
        {/* Markdown detect has problem. */}
        {props.content}
      </ReactMarkdown>
    </div>
  )
}
