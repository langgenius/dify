/**
 * @fileoverview Link component for rendering <a> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Handles special rendering for "abbr:" type links for interactive chat actions.
 */
import React from 'react'
import { useChatContext } from '@/app/components/base/chat/chat/context'

const Link = ({ node, children, ...props }: any) => {
  const { onSend } = useChatContext()
  if (node.properties?.href && node.properties.href?.toString().startsWith('abbr')) {
    const hidden_text = decodeURIComponent(node.properties.href.toString().split('abbr:')[1])

    return <abbr className="cursor-pointer underline !decoration-primary-700 decoration-dashed" onClick={() => onSend?.(hidden_text)} title={node.children[0]?.value || ''}>{node.children[0]?.value || ''}</abbr>
  }
  else {
    return <a {...props} target="_blank" className="cursor-pointer underline !decoration-primary-700 decoration-dashed">{children || 'Download'}</a>
  }
}

export default Link
