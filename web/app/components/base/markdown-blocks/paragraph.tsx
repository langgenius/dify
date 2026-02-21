/**
 * @fileoverview Paragraph component for rendering <p> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Handles special rendering for paragraphs that contain images.
 *
 * When a paragraph's first child is an image, it renders as a dedicated
 * image block with ImageGallery. When images appear elsewhere among the
 * children, it renders as a <div> to avoid invalid HTML nesting
 * (<div> inside <p>), which causes React hydration warnings.
 */
import * as React from 'react'
import ImageGallery from '@/app/components/base/image-gallery'

/**
 * Check whether any AST child node is an img element.
 */
function hasImageChild(children: any[]): boolean {
  return children.some(
    child => child && 'tagName' in child && child.tagName === 'img',
  )
}

const Paragraph = (paragraph: any) => {
  const { node }: any = paragraph
  const children_node = node.children

  // First child is an image → render as dedicated image block
  if (children_node?.[0] && 'tagName' in children_node[0] && children_node[0].tagName === 'img') {
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

  // If any child is an image, use <div> instead of <p> to avoid
  // invalid DOM nesting (block-level <div> inside <p>).
  if (children_node && hasImageChild(children_node))
    return <div className="markdown-paragraph">{paragraph.children}</div>

  return <p>{paragraph.children}</p>
}

export default Paragraph
