/**
 * @fileoverview Img component for rendering <img> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Uses the ImageGallery component to display images.
 */
import * as React from 'react'
import ImageGallery from '@/app/components/base/image-gallery'

const Img = ({ src }: any) => {
  return <span className="markdown-img-wrapper inline-block"><ImageGallery srcs={[src]} /></span>
}

export default Img
