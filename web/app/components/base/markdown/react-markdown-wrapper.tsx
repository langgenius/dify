import ReactMarkdown from 'react-markdown'
import RemarkMath from 'remark-math'
import RemarkBreaks from 'remark-breaks'
import RehypeKatex from 'rehype-katex'
import RemarkGfm from 'remark-gfm'
import RehypeRaw from 'rehype-raw'
import { ENABLE_SINGLE_DOLLAR_LATEX } from '@/config'
import AudioBlock from '@/app/components/base/markdown-blocks/audio-block'
import Img from '@/app/components/base/markdown-blocks/img'
import Link from '@/app/components/base/markdown-blocks/link'
import MarkdownButton from '@/app/components/base/markdown-blocks/button'
import MarkdownForm from '@/app/components/base/markdown-blocks/form'
import Paragraph from '@/app/components/base/markdown-blocks/paragraph'
import ScriptBlock from '@/app/components/base/markdown-blocks/script-block'
import ThinkBlock from '@/app/components/base/markdown-blocks/think-block'
import VideoBlock from '@/app/components/base/markdown-blocks/video-block'
import { customUrlTransform } from './markdown-utils'

import type { FC } from 'react'

import dynamic from 'next/dynamic'

const CodeBlock = dynamic(() => import('@/app/components/base/markdown-blocks/code-block'), { ssr: false })

export type ReactMarkdownWrapperProps = {
  latexContent: any
  customDisallowedElements?: string[]
  customComponents?: Record<string, React.ComponentType<any>>
}

export const ReactMarkdownWrapper: FC<ReactMarkdownWrapperProps> = (props) => {
  const { customComponents, latexContent } = props

  return (
    <ReactMarkdown
      remarkPlugins={[
        RemarkGfm,
        [RemarkMath, { singleDollarTextMath: ENABLE_SINGLE_DOLLAR_LATEX }],
        RemarkBreaks,
      ]}
      rehypePlugins={[
        RehypeKatex,
        RehypeRaw as any,
          // The Rehype plug-in is used to remove the ref attribute of an element
        () => {
          return (tree: any) => {
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
      urlTransform={customUrlTransform}
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
        ...customComponents,
      }}
    >
      {/* Markdown detect has problem. */}
      {latexContent}
    </ReactMarkdown>
  )
}
