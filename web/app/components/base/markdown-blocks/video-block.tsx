/**
 * @fileoverview VideoBlock component for rendering video elements in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Uses the VideoGallery component to display videos.
 */
import React, { memo } from 'react'
import VideoGallery from '@/app/components/base/video-gallery'

const VideoBlock: any = memo(({ node }: any) => {
  const srcs = node.children.filter((child: any) => 'properties' in child).map((child: any) => (child as any).properties.src)
  if (srcs.length === 0) {
    const src = node.properties?.src
    if (src)
      return <VideoGallery key={src} srcs={[src]} />
    return null
  }
  return <VideoGallery key={srcs.join()} srcs={srcs} />
})
VideoBlock.displayName = 'VideoBlock'

export default VideoBlock
