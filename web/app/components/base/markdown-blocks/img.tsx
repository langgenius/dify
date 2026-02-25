/**
 * @fileoverview Img component for rendering <img> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Uses the ImageGallery component to display images.
 */
import * as React from 'react'

export default function Img(props: any) {
  const { src, alt, ...rest } = props
  return <img src={src} alt={alt ?? ''} {...rest} />
}
