/**
 * @fileoverview Paragraph component for rendering <p> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Handles special rendering for paragraphs that contain images to avoid
 * nesting <div> inside <p> which causes hydration warnings in Next.js.
 */
import * as React from 'react'
import type { Element } from 'hast'
import ImageGallery from '@/app/components/base/image-gallery'

interface ParagraphProps {
  node: Element
  children: React.ReactNode
}

const Paragraph = ({ node, children }: ParagraphProps) => {
  const childrenNodes = node.children

  // Find the first image index in one pass
  const firstImageIndex = childrenNodes?.findIndex(
    (child): child is Element =>
      child.type === 'element' && child.tagName === 'img',
  ) ?? -1

  // No image in paragraph, render a normal <p>
  if (firstImageIndex === -1)
    return <p>{children}</p>

  // Image is the first element, use special gallery layout
  if (firstImageIndex === 0) {
    const firstChild = childrenNodes[0] as Element
    return (
      <div className="markdown-img-wrapper">
        <ImageGallery srcs={[(firstChild.properties?.src as string) || '']} />
        {Array.isArray(children) && children.length > 1 && (
          <div className="mt-2">{children.slice(1)}</div>
        )}
      </div>
    )
  }

  // Image is present but not first, render as div to avoid invalid nesting
  return <div className="markdown-paragraph">{children}</div>
}

export default Paragraph
