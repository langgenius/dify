'use client'
import dynamic from 'next/dynamic'
import 'katex/dist/katex.min.css'
import { flow } from 'lodash-es'
import DOMPurify from 'dompurify'
import { useMemo } from 'react'
import cn from '@/utils/classnames'
import { preprocessLaTeX, preprocessThinkTag } from './markdown-utils'
import type { ReactMarkdownWrapperProps, SimplePluginInfo } from './react-markdown-wrapper'

const ReactMarkdown = dynamic(() => import('./react-markdown-wrapper').then(mod => mod.ReactMarkdownWrapper), { ssr: false })

const SANITIZE_OPTIONS: DOMPurify.Config = {
  USE_PROFILES: { html: true },
  ADD_TAGS: ['details', 'summary'],
  FORBID_TAGS: ['style', 'script'],
}

export const sanitizeMarkdownContent = (content: string) => DOMPurify.sanitize(content, SANITIZE_OPTIONS)

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
  const sanitizedContent = useMemo(() => sanitizeMarkdownContent(latexContent), [latexContent])

  return (
    <div className={cn('markdown-body', '!text-text-primary', props.className)}>
      <ReactMarkdown pluginInfo={pluginInfo} latexContent={sanitizedContent} customComponents={customComponents} customDisallowedElements={props.customDisallowedElements} />
    </div>
  )
}
