import * as React from 'react'

type ImageRenderProps = {
  sourceUrl: string
  name: string
}

const ImageRender = ({
  sourceUrl,
  name,
}: ImageRenderProps) => {
  return (
    <div className="size-full border-[2px] border-effects-image-frame shadow-xs">
      <img
        className="size-full object-cover"
        src={sourceUrl}
        alt={name}
      />
    </div>
  )
}

export default React.memo(ImageRender)
