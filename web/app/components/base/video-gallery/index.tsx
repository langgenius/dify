import * as React from 'react'
import VideoPlayer from './VideoPlayer'

type Props = {
  srcs: string[]
}

const VideoGallery: React.FC<Props> = ({ srcs }) => {
  const validSrcs = srcs.filter(src => src)
  if (validSrcs.length === 0)
    return null

  return (
    <div className="my-3">
      <VideoPlayer srcs={validSrcs} />
    </div>
  )
}

export default React.memo(VideoGallery)
