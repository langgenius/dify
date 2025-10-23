import dynamic from 'next/dynamic'
import 'katex/dist/katex.min.css'
import { flow } from 'lodash-es'
import cn from '@/utils/classnames'
import { preprocessLaTeX, preprocessThinkTag } from './markdown-utils'
import type { ReactMarkdownWrapperProps } from './react-markdown-wrapper'

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
} & Pick<ReactMarkdownWrapperProps, 'customComponents' | 'customDisallowedElements'>

export const Markdown = (props: MarkdownProps) => {
  const { customComponents = {} } = props
  const latexContent = flow([
    preprocessThinkTag,
    preprocessLaTeX,
  ])(props.content)

  return (
    <div className={cn('markdown-body', '!text-text-primary', props.className)}>
      <ReactMarkdown latexContent={latexContent} customComponents={customComponents} customDisallowedElements={props.customDisallowedElements} />
    </div>
  )
}
