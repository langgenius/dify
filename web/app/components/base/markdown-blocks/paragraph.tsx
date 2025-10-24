/**
 * @fileoverview Paragraph component for rendering <p> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Handles special rendering for paragraphs that directly contain an image.
 */
import React, { useEffect, useMemo } from 'react'
import ImageGallery from '@/app/components/base/image-gallery'
import { getMarkdownImageURL } from './utils'
import { usePluginReadmeAsset } from '@/service/use-plugins'
import type { SimplePluginInfo } from '../markdown/react-markdown-wrapper'

const Paragraph = (props: { pluginInfo?: SimplePluginInfo, node?: any, children?: any }) => {
  const { node, pluginInfo, children } = props
  const { plugin_unique_identifier, plugin_id } = pluginInfo || {}
  const children_node = node.children
  const { data: assetData } = usePluginReadmeAsset({ plugin_unique_identifier, file_name: children_node?.[0]?.tagName !== 'img' ? '' : children_node[0].properties?.src })

  const blobUrl = useMemo(() => {
    if (assetData)
      return URL.createObjectURL(assetData)

    if (children_node?.[0]?.tagName === 'img' && children_node[0].properties?.src)
      return getMarkdownImageURL(children_node[0].properties.src, plugin_id)

    return ''
  }, [assetData, children_node, plugin_id])

  useEffect(() => {
    return () => {
      if (blobUrl && assetData)
        URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl, assetData])

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
