import ImageGallery from '@/app/components/base/image-gallery'
import { hasImageChild } from './utils'

const Paragraph = (paragraph: any) => {
  const { node }: any = paragraph
  const children_node = node.children
  const hasImage = hasImageChild(children_node)

  if (hasImage) {
    if (children_node[0]?.tagName === 'img') {
      return (
        <div className="markdown-img-wrapper">
          <ImageGallery srcs={[children_node[0].properties.src]} />
          {Array.isArray(paragraph.children) && paragraph.children.length > 1
            ? <div className="mt-2">{paragraph.children.slice(1)}</div>
            : null}
        </div>
      )
    }
    return <div className="markdown-p">{paragraph.children}</div>
  }

  return <p>{paragraph.children}</p>
}

export default Paragraph
