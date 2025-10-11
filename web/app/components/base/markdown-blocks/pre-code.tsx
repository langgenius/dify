/**
 * @fileoverview PreCode component for rendering <pre> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * This is a simple wrapper around the HTML <pre> element.
 */
import React, { useRef } from 'react'

function PreCode(props: { children: any }) {
  const ref = useRef<HTMLPreElement>(null)

  return (
    <pre ref={ref}>
      <span
        className="copy-code-button"
      ></span>
      {props.children}
    </pre>
  )
}

export default PreCode
