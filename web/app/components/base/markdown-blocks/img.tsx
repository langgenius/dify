/**
 * @fileoverview Img component for rendering <img> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Uses the ImageGallery component to display images.
 */
import React, { useEffect, useMemo } from 'react'
import ImageGallery from '@/app/components/base/image-gallery'
import { getMarkdownImageURL } from './utils'
import { usePluginReadmeAsset } from '@/service/use-plugins'
import type { SimplePluginInfo } from '../markdown/react-markdown-wrapper'

const Img = ({ src, pluginInfo }: { src: string, pluginInfo?: SimplePluginInfo }) => {
  const { plugin_unique_identifier, plugin_id } = pluginInfo || {}
  const { data: assetData } = usePluginReadmeAsset({ plugin_unique_identifier, file_name: src })

  const blobUrl = useMemo(() => {
    if (assetData)
      return URL.createObjectURL(assetData)

    return getMarkdownImageURL(src, plugin_id)
  }, [assetData, plugin_id, src])

  useEffect(() => {
    return () => {
      if (blobUrl && assetData)
        URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl, assetData])

  return (
    <div className='markdown-img-wrapper'>
      <ImageGallery srcs={[blobUrl]} />
    </div>
  )
}

export default Img
