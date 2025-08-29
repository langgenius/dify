/**
 * @fileoverview Paragraph component for rendering <p> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Handles special rendering for paragraphs that directly contain an image.
 */
import React, { useEffect, useMemo } from 'react'
import ImageGallery from '@/app/components/base/image-gallery'
import { getMarkdownImageURL } from './utils'
import { usePluginReadmeAsset } from '@/service/use-plugins'

const Paragraph = (props: { pluginUniqueIdentifier?: string, node?: any, children?: any }) => {
  const { node, pluginUniqueIdentifier, children } = props
  const children_node = node.children
  const imgURL = getMarkdownImageURL(children_node[0].properties?.src, pluginUniqueIdentifier)
  const { data: asset } = usePluginReadmeAsset({ plugin_unique_identifier: pluginUniqueIdentifier, file_name: children_node[0].properties?.src })

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

  if (children_node?.[0]?.tagName === 'img') {
    return (
      <div className="markdown-img-wrapper">
        <ImageGallery srcs={[blobUrl]} />
        {
          Array.isArray(children) && children.length > 1 && (
            <div className="mt-2">{children.slice(1)}</div>
          )
        }
      </div>
    )
  }
  return <p>{children}</p>
}

export default Paragraph
