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
  if (children_node && children_node[0] && 'tagName' in children_node[0] && children_node[0].tagName === 'img') {
    return (
      <span className="markdown-img-wrapper" style={{ display: 'block' }}>
        <ImageGallery srcs={[children_node[0].properties.src]} />
        {
          Array.isArray(paragraph.children) && paragraph.children.length > 1 && (
            <span className="mt-2" style={{ display: 'block' }}>{paragraph.children.slice(1)}</span>
          )
        }
      </span>
    )
  }
  return <p>{paragraph.children}</p>
}

export default Paragraph
