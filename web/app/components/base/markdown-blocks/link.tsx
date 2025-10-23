/**
 * @fileoverview Link component for rendering <a> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Handles special rendering for "abbr:" type links for interactive chat actions.
 */
import React from 'react'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import { isValidUrl } from './utils'

const Link = ({ node, children, ...props }: any) => {
  const { onSend } = useChatContext()
  const commonClassName = 'cursor-pointer underline !decoration-primary-700 decoration-dashed'
  if (node.properties?.href && node.properties.href?.toString().startsWith('abbr')) {
    const hidden_text = decodeURIComponent(node.properties.href.toString().split('abbr:')[1])

    return <abbr className={commonClassName} onClick={() => onSend?.(hidden_text)} title={node.children[0]?.value || ''}>{node.children[0]?.value || ''}</abbr>
  }
  else {
    const href = props.href || node.properties?.href
    if (href && /^#[a-zA-Z0-9_-]+$/.test(href.toString())) {
      const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault()
        // scroll to target element if exists within the answer container
        const answerContainer = e.currentTarget.closest('.chat-answer-container')

        if (answerContainer) {
          const targetId = CSS.escape(href.toString().substring(1))
          const targetElement = answerContainer.querySelector(`[id="${targetId}"]`)
          if (targetElement)
            targetElement.scrollIntoView({ behavior: 'smooth' })
        }
      }
      return <a href={href} onClick={handleClick} className={commonClassName}>{children || 'ScrollView'}</a>
    }

    if (!href || !isValidUrl(href))
      return <span>{children}</span>

    return <a href={href} target="_blank" rel="noopener noreferrer" className={commonClassName}>{children || 'Download'}</a>
  }
}

export default Link
