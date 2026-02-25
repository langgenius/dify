/**
 * @fileoverview Paragraph component for rendering <p> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Handles special rendering for paragraphs that directly contain an image.
 */
import * as React from 'react'
import ImageGallery from '@/app/components/base/image-gallery'

type MdastNode = {
  tagName?: string
  children?: MdastNode[]
  properties?: Record<string, unknown>
}

type ParagraphProps = {
  node: MdastNode
  children: React.ReactNode[]
}

const hasImageChild = (children?: MdastNode[]): boolean => {
  if (!children)
    return false
  return children.some((child: MdastNode) => {
    if (child.tagName === 'img')
      return true
    if (child.children)
      return hasImageChild(child.children)
    return false
  })
}

const Paragraph = (paragraph: ParagraphProps) => {
  const { node } = paragraph
  const children_node = node.children
  if (children_node && children_node[0] && 'tagName' in children_node[0] && children_node[0].tagName === 'img') {
    return (
      <div className="markdown-img-wrapper">
        <ImageGallery srcs={[(children_node[0].properties as Record<string, string>)?.src]} />
        {
          Array.isArray(paragraph.children) && paragraph.children.length > 1 && (
            <div className="mt-2">{paragraph.children.slice(1)}</div>
          )
        }
      </div>
    )
  }
  // When an image appears anywhere in the paragraph (not just as the first child),
  // render as <div> instead of <p> to avoid invalid DOM nesting.
  // Block-level elements like <div> (from Img/ImageGallery) cannot be nested inside <p>.
  if (hasImageChild(children_node))
    return <div className="markdown-img-wrapper">{paragraph.children}</div>

  return <p>{paragraph.children}</p>
}

export default Paragraph
