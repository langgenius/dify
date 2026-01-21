import type { SimplePluginInfo } from '../markdown/react-markdown-wrapper'
/**
 * @fileoverview Img component for rendering <img> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Uses the ImageGallery component to display images.
 */
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import ImageGallery from '@/app/components/base/image-gallery'
import { usePluginReadmeAsset } from '@/service/use-plugins'
import { getMarkdownImageURL } from './utils'

type ImgProps = {
  src: string
  pluginInfo?: SimplePluginInfo
}

export const PluginImg: React.FC<ImgProps> = ({ src, pluginInfo }) => {
  const { pluginUniqueIdentifier, pluginId } = pluginInfo || {}
  const { data: assetData } = usePluginReadmeAsset({ plugin_unique_identifier: pluginUniqueIdentifier, file_name: src })
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

    return getMarkdownImageURL(src, pluginId)
  }, [blobUrl, pluginId, src])

  return (
    <div className="markdown-img-wrapper">
      <ImageGallery srcs={[imageUrl]} />
    </div>
  )
}
