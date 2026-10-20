import type { SimplePluginInfo } from '../markdown/streamdown-wrapper'
/**
 * @fileoverview Img component for rendering <img> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Uses the ImageGallery component to display images.
 */
import { useQuery } from '@tanstack/react-query'
import { memo, useEffect, useMemo, useState } from 'react'
import ImageGallery from '@/app/components/base/image-gallery'
import { pluginAssetQueryOptions } from './plugin-asset-query'
import { getMarkdownImageURL } from './utils'

type ImgProps = {
  src: string
  pluginInfo?: SimplePluginInfo
}

export const PluginImg = memo<ImgProps>(({ src, pluginInfo }) => {
  const { pluginUniqueIdentifier, pluginId } = pluginInfo || {}
  const { data: assetData } = useQuery(pluginAssetQueryOptions(src, pluginUniqueIdentifier))
  const [blobUrl, setBlobUrl] = useState<{ data: Blob; url: string }>()

  useEffect(() => {
    if (!assetData) {
      setBlobUrl(undefined)
      return
    }

    const objectUrl = URL.createObjectURL(assetData)
    setBlobUrl({ data: assetData, url: objectUrl })

    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [assetData])

  const imageUrl = useMemo(() => {
    if (blobUrl && blobUrl.data === assetData) return blobUrl.url

    return getMarkdownImageURL(src, pluginId)
  }, [assetData, blobUrl, pluginId, src])

  const srcs = useMemo(() => [imageUrl], [imageUrl])

  return (
    <div className="markdown-img-wrapper">
      <ImageGallery key={JSON.stringify([pluginUniqueIdentifier, imageUrl])} srcs={srcs} />
    </div>
  )
})
