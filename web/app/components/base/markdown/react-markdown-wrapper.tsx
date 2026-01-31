import type { FC } from 'react'
import dynamic from 'next/dynamic'
import ReactMarkdown from 'react-markdown'
import RehypeKatex from 'rehype-katex'
import RehypeRaw from 'rehype-raw'
import RemarkBreaks from 'remark-breaks'
import RemarkGfm from 'remark-gfm'
import RemarkMath from 'remark-math'
import { AudioBlock, Img, Link, MarkdownButton, MarkdownForm, Paragraph, PluginImg, PluginParagraph, ScriptBlock, ThinkBlock, VideoBlock } from '@/app/components/base/markdown-blocks'
import { ENABLE_SINGLE_DOLLAR_LATEX } from '@/config'
import { customUrlTransform } from './markdown-utils'

const CodeBlock = dynamic(() => import('@/app/components/base/markdown-blocks/code-block'), { ssr: false })

export type SimplePluginInfo = {
  pluginUniqueIdentifier: string
  pluginId: string
}

export type ReactMarkdownWrapperProps = {
  latexContent: any
  customDisallowedElements?: string[]
  customComponents?: Record<string, React.ComponentType<any>>
  pluginInfo?: SimplePluginInfo
}

export const ReactMarkdownWrapper: FC<ReactMarkdownWrapperProps> = (props) => {
  const { customComponents, latexContent, pluginInfo } = props

  return (
    <ReactMarkdown
      remarkPlugins={[
        [RemarkGfm, { singleTilde: false }],
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
        img: (props: any) => pluginInfo ? <PluginImg {...props} pluginInfo={pluginInfo} /> : <Img {...props} />,
        video: VideoBlock,
        audio: AudioBlock,
        a: Link,
        p: (props: any) => pluginInfo ? <PluginParagraph {...props} pluginInfo={pluginInfo} /> : <Paragraph {...props} />,
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
