/**
 * @fileoverview Paragraph component for rendering <p> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Handles special rendering for paragraphs that contain images to avoid
 * nesting <div> inside <p> which causes hydration warnings in Next.js.
 */
import * as React from 'react'
import ImageGallery from '@/app/components/base/image-gallery'

const Paragraph = (paragraph: any) => {
  const { node }: any = paragraph
  const children_node = node.children

  // Check if any child is an image (not just the first one)
  const hasImage = children_node?.some(
    (child: any) => 'tagName' in child && child.tagName === 'img',
  )

  // If paragraph contains any image, render as div to avoid <div> inside <p> hydration error
  if (hasImage) {
    // If the first child is an image, use the special ImageGallery rendering
    if (children_node[0] && 'tagName' in children_node[0] && children_node[0].tagName === 'img') {
      return (
        <div className="markdown-img-wrapper">
          <ImageGallery srcs={[children_node[0].properties.src]} />
          {
            Array.isArray(paragraph.children) && paragraph.children.length > 1 && (
              <div className="mt-2">{paragraph.children.slice(1)}</div>
            )
          }
        </div>
      )
    }
    // For images in the middle/end of paragraph, wrap in div instead of p
    return <div className="markdown-paragraph">{paragraph.children}</div>
  }

  return <p>{paragraph.children}</p>
}

export default Paragraph
