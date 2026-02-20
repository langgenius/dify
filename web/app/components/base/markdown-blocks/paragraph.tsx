/**
 * @fileoverview Paragraph component for rendering <p> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Handles special rendering for paragraphs that contain images,
 * avoiding invalid HTML nesting of <div> inside <p>.
 */
import * as React from 'react'
import ImageGallery from '@/app/components/base/image-gallery'

const Paragraph = (paragraph: any) => {
  const { node }: any = paragraph
  const children_node = node.children

  // Check if any child is an img tag — if so, we must use <div> instead of <p>
  // to avoid invalid HTML nesting (img renders as <div> via ImageGallery)
  const hasImage = children_node?.some(
    (child: any) => 'tagName' in child && child.tagName === 'img',
  )

  if (hasImage) {
    // If the first child is an image, render it via ImageGallery with remaining children
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
    // Image is not the first child — use <div> instead of <p> to avoid hydration error
    return <div className="markdown-p">{paragraph.children}</div>
  }

  return <p>{paragraph.children}</p>
}

export default Paragraph
