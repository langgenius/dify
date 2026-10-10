import * as React from 'react'

type ImageRenderProps = {
  sourceUrl: string
  name: string
}

const ImageRender = ({ sourceUrl, name }: ImageRenderProps) => {
  return (
    <span className="block size-full border-2 border-effects-image-frame shadow-xs">
      <img className="size-full object-cover" src={sourceUrl || undefined} alt={name} />
    </span>
  )
}

export default React.memo(ImageRender)
