/**
 * @fileoverview Img component for rendering <img> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Uses the ImageGallery component to display images.
 */
import React, { useEffect, useMemo } from 'react'
import ImageGallery from '@/app/components/base/image-gallery'
import { getMarkdownImageURL } from './utils'
import { usePluginReadmeAsset } from '@/service/use-plugins'

const Img = ({ src, pluginUniqueIdentifier }: { src: string, pluginUniqueIdentifier?: string }) => {
  const imgURL = getMarkdownImageURL(src, pluginUniqueIdentifier)
  const { data: asset } = usePluginReadmeAsset({ plugin_unique_identifier: pluginUniqueIdentifier, file_name: src })

  const blobUrl = useMemo(() => {
    if (asset)
      return URL.createObjectURL(asset)

    return imgURL
  }, [asset, imgURL])

  useEffect(() => {
    return () => {
      if (blobUrl && asset)
        URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  return (
    <div className='markdown-img-wrapper'>
      <ImageGallery srcs={[blobUrl]} />
    </div>
  )
}

export default Img
