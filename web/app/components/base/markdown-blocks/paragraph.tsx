/**
 * @fileoverview Paragraph component for rendering <p> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Handles special rendering for paragraphs that directly contain an image.
 */
import * as React from 'react'
import ImageGallery from '@/app/components/base/image-gallery'

const Paragraph = (paragraph: any) => {
  const { node }: any = paragraph
  const children_node = node.children
  
  // Check if any child is an image
  const hasImage = children_node?.some((child: any) => 
    child.tagName === 'img' || (child.children?.some((innerChild: any) => innerChild.tagName === 'img'))
  )

  if (hasImage) {
    if (children_node && children_node[0] && 'tagName' in children_node[0] && children_node[0].tagName === 'img') {
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
    // If image is not the first child, we still need to wrap in div to avoid p > div error
    return <div className="mb-2">{paragraph.children}</div>
  }
  
  return <p>{paragraph.children}</p>
}

export default Paragraph
