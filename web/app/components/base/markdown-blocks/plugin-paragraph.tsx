import type { SimplePluginInfo } from '../markdown/react-markdown-wrapper'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
/**
 * @fileoverview Paragraph component for rendering <p> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Handles special rendering for paragraphs that directly contain an image.
 */
import ImageGallery from '@/app/components/base/image-gallery'
import { usePluginReadmeAsset } from '@/service/use-plugins'
import { getMarkdownImageURL } from './utils'

type PluginParagraphProps = {
  pluginInfo?: SimplePluginInfo
  node?: any
  children?: React.ReactNode
}

export const PluginParagraph: React.FC<PluginParagraphProps> = ({ pluginInfo, node, children }) => {
  const { pluginUniqueIdentifier, pluginId } = pluginInfo || {}
  const childrenNode = node?.children as Array<any> | undefined
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
      <div className="markdown-img-wrapper">
        <ImageGallery srcs={[imageUrl]} />
        {remainingChildren && (
          <div className="mt-2">{remainingChildren}</div>
        )}
      </div>
    )
  }
  return <p>{children}</p>
}
