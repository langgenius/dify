import type { ExtraProps } from 'streamdown'
import type { SimplePluginInfo } from '../markdown/streamdown-wrapper'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import ImageGallery from '@/app/components/base/image-gallery'
import { pluginAssetQueryOptions } from './plugin-asset-query'
import { getMarkdownImageURL, hasImageChild } from './utils'

type PluginParagraphProps = {
  pluginInfo?: SimplePluginInfo
  node?: ExtraProps['node']
  children?: React.ReactNode
}

export const PluginParagraph: React.FC<PluginParagraphProps> = ({ pluginInfo, node, children }) => {
  const { pluginUniqueIdentifier, pluginId } = pluginInfo || {}
  const childrenNode = node?.children
  const firstChild = childrenNode?.[0]
  const isImageParagraph = firstChild?.type === 'element' && firstChild.tagName === 'img'
  const imageSrc = isImageParagraph ? firstChild.properties.src : undefined

  const { data: assetData } = useQuery(pluginAssetQueryOptions(imageSrc, pluginUniqueIdentifier))

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

    if (isImageParagraph && imageSrc) return getMarkdownImageURL(imageSrc, pluginId)

    return ''
  }, [assetData, blobUrl, imageSrc, isImageParagraph, pluginId])

  if (isImageParagraph) {
    const remainingChildren =
      Array.isArray(children) && children.length > 1 ? children.slice(1) : undefined

    return (
      <div className="markdown-img-wrapper" data-testid="image-paragraph-wrapper">
        <ImageGallery key={JSON.stringify([pluginUniqueIdentifier, imageUrl])} srcs={[imageUrl]} />
        {remainingChildren && (
          <div className="mt-2" data-testid="remaining-children">
            {remainingChildren}
          </div>
        )}
      </div>
    )
  }
  if (hasImageChild(childrenNode))
    return (
      <div className="markdown-p" data-testid="image-fallback-paragraph">
        {children}
      </div>
    )

  return <p data-testid="standard-paragraph">{children}</p>
}
