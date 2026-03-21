/**
 * @fileoverview AudioBlock component for rendering audio elements in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Uses the AudioGallery component to display audio players.
 */
import * as React from 'react'
import { memo } from 'react'
import AudioGallery from '@/app/components/base/audio-gallery'

const AudioBlock: any = memo(({ node }: any) => {
  const srcs = node.children.filter((child: any) => 'properties' in child).map((child: any) => (child as any).properties.src)
  if (srcs.length === 0) {
    const src = node.properties?.src
    if (src)
      return <AudioGallery key={src} srcs={[src]} />
    return null
  }
  return <AudioGallery key={srcs.join()} srcs={srcs} />
})
AudioBlock.displayName = 'AudioBlock'

export default AudioBlock
