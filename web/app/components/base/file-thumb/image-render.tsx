import * as React from 'react'

type ImageRenderProps = {
  sourceUrl: string
  name: string
  onError?: () => void
}

const ImageRender = ({ sourceUrl, name, onError }: ImageRenderProps) => {
  return (
    <div className="size-full border-2 border-effects-image-frame shadow-xs">
      <img
        alt={name}
        className="size-full object-cover"
        decoding="async"
        loading="lazy"
        onError={onError}
        src={sourceUrl}
      />
    </div>
  )
}

export default React.memo(ImageRender)
