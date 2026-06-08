/**
 * @fileoverview Img component for rendering <img> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Uses the ImageGallery component to display images.
 */
import { memo, useMemo } from 'react'
import ImageGallery from '@/app/components/base/image-gallery'

const Img = memo(({ src }: { src: string }) => {
  const srcs = useMemo(() => [src], [src])
  return <div className="markdown-img-wrapper"><ImageGallery srcs={srcs} /></div>
})

export default Img
