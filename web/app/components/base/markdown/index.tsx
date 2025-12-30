import type { ReactMarkdownWrapperProps, SimplePluginInfo } from './react-markdown-wrapper'
import { flow } from 'es-toolkit/compat'
import dynamic from 'next/dynamic'
import { cn } from '@/utils/classnames'
import { preprocessLaTeX, preprocessThinkTag } from './markdown-utils'
import 'katex/dist/katex.min.css'

const ReactMarkdown = dynamic(() => import('./react-markdown-wrapper').then(mod => mod.ReactMarkdownWrapper), { ssr: false })

/**
 * @fileoverview Main Markdown rendering component.
 * This file was refactored to extract individual block renderers and utility functions
 * into separate modules for better organization and maintainability as of [Date of refactor].
 * Further refactoring candidates (custom block components not fitting general categories)
 * are noted in their respective files if applicable.
 */
export type MarkdownProps = {
  content: string
  className?: string
  pluginInfo?: SimplePluginInfo
} & Pick<ReactMarkdownWrapperProps, 'customComponents' | 'customDisallowedElements'>

export const Markdown = (props: MarkdownProps) => {
  const { customComponents = {}, pluginInfo } = props
  const latexContent = flow([
    preprocessThinkTag,
    preprocessLaTeX,
  ])(props.content)

  return (
    <div className={cn('markdown-body', '!text-text-primary', props.className)}>
      <ReactMarkdown pluginInfo={pluginInfo} latexContent={latexContent} customComponents={customComponents} customDisallowedElements={props.customDisallowedElements} />
    </div>
  )
}
