import type { ExtraProps } from 'streamdown'
import type { SimplePluginInfo } from '../markdown/streamdown-wrapper'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import ImageGallery from '@/app/components/base/image-gallery'
import { usePluginReadmeAsset } from '@/service/use-plugins'
import { getMarkdownImageURL, hasImageChild } from './utils'

type HastChildNode = {
  tagName?: string
  properties?: { src?: string, [key: string]: unknown }
}

type PluginParagraphProps = {
  pluginInfo?: SimplePluginInfo
  node?: ExtraProps['node']
  children?: React.ReactNode
}

export const PluginParagraph: React.FC<PluginParagraphProps> = ({ pluginInfo, node, children }) => {
  const { pluginUniqueIdentifier, pluginId } = pluginInfo || {}
  const childrenNode = node?.children as HastChildNode[] | undefined
  const firstChild = childrenNode?.[0]
  const isImageParagraph = firstChild?.tagName === 'img'
  const imageSrc = isImageParagraph ? firstChild?.properties?.src : undefined

  const { data: assetData } = usePluginReadmeAsset({
    plugin_unique_identifier: pluginUniqueIdentifier,
    file_name: isImageParagraph && imageSrc ? imageSrc : '',
  })

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

    if (isImageParagraph && imageSrc)
      return getMarkdownImageURL(imageSrc, pluginId)

    return ''
  }, [blobUrl, imageSrc, isImageParagraph, pluginId])

  if (isImageParagraph) {
    const remainingChildren = Array.isArray(children) && children.length > 1 ? children.slice(1) : undefined

    return (
      <div className="markdown-img-wrapper" data-testid="image-paragraph-wrapper">
        <ImageGallery srcs={[imageUrl]} />
        {remainingChildren && (
          <div className="mt-2" data-testid="remaining-children">{remainingChildren}</div>
        )}
      </div>
    )
  }
  if (hasImageChild(childrenNode))
    return <div className="markdown-p" data-testid="image-fallback-paragraph">{children}</div>

  return <p data-testid="standard-paragraph">{children}</p>
}
