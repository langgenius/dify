/**
 * @fileoverview Img component for rendering <img> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Uses the ImageGallery component to display images.
 */
import React, { useEffect, useMemo, useState } from 'react'
import ImageGallery from '@/app/components/base/image-gallery'
import { getMarkdownImageURL } from './utils'
import { usePluginReadmeAsset } from '@/service/use-plugins'
import type { SimplePluginInfo } from '../markdown/react-markdown-wrapper'

type ImgProps = {
  src: string
  pluginInfo?: SimplePluginInfo
}

const Img: React.FC<ImgProps> = ({ src, pluginInfo }) => {
  const { plugin_unique_identifier, plugin_id } = pluginInfo || {}
  const { data: assetData } = usePluginReadmeAsset({ plugin_unique_identifier, file_name: src })
  const [blobUrl, setBlobUrl] = useState<string>()

  useEffect(() => {
    if (!assetData) {
      setBlobUrl(undefined)
      return
    }

    const objectUrl = URL.createObjectURL(assetData)
    setBlobUrl(objectUrl)

    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [assetData])

  const imageUrl = useMemo(() => {
    if (blobUrl)
      return blobUrl

    return getMarkdownImageURL(src, plugin_id)
  }, [blobUrl, plugin_id, src])

  return (
    <div className="markdown-img-wrapper">
      <ImageGallery srcs={[imageUrl]} />
    </div>
  )
}

export default Img
