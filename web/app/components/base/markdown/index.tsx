import type { SimplePluginInfo, StreamdownWrapperProps } from './streamdown-wrapper'
import { cn } from '@langgenius/dify-ui/cn'
import { flow } from 'es-toolkit/compat'
import dynamic from 'next/dynamic'
import { memo, useMemo } from 'react'
import { preprocessLaTeX, preprocessThinkTag } from './markdown-utils'

const StreamdownWrapper = dynamic(() => import('./streamdown-wrapper'), { ssr: false })

const preprocess = flow([preprocessThinkTag, preprocessLaTeX])

const EMPTY_COMPONENTS = {} as const
const MARKDOWN_DIVIDER_ONLY_RE =
  /^(?:[ \t]*\r?\n)*[ \t]{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})(?:\r?\n[ \t]*)*$/

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
} & Pick<
  StreamdownWrapperProps,
  | 'customComponents'
  | 'customDisallowedElements'
  | 'remarkPlugins'
  | 'rehypePlugins'
  | 'isAnimating'
  | 'mode'
>

export const Markdown = memo((props: MarkdownProps) => {
  const {
    content,
    customComponents = EMPTY_COMPONENTS,
    pluginInfo,
    isAnimating,
    customDisallowedElements,
    remarkPlugins,
    rehypePlugins,
    mode,
    className,
  } = props
  const latexContent = useMemo(() => preprocess(content), [content])
  const hasContent = !!latexContent.trim() && !MARKDOWN_DIVIDER_ONLY_RE.test(latexContent)

  return (
    <div
      className={cn('markdown-body', 'text-text-primary!', className)}
      data-testid="markdown-body"
    >
      {hasContent && (
        <StreamdownWrapper
          pluginInfo={pluginInfo}
          latexContent={latexContent}
          customComponents={customComponents}
          customDisallowedElements={customDisallowedElements}
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          isAnimating={isAnimating}
          mode={mode}
        />
      )}
    </div>
  )
})

Markdown.displayName = 'Markdown'
