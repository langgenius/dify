import * as React from 'react'
import AudioPlayer from './AudioPlayer'

type Props = {
  srcs: string[]
}

const AudioGallery: React.FC<Props> = ({ srcs }) => {
  const validSrcs = srcs.filter(src => src)
  if (validSrcs.length === 0)
    return null

  return (
    <div className="my-3">
      <AudioPlayer srcs={validSrcs} />
    </div>
  )
}

export default React.memo(AudioGallery)
