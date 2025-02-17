import React from 'react'
import VideoPlayer from './VideoPlayer'

type Props = {
  srcs: string[]
}

const VideoGallery: React.FC<Props> = ({ srcs }) => {
  return (<><br/>{srcs.map((src, index) => (<React.Fragment key={`video_${index}`}><br/><VideoPlayer src={src}/></React.Fragment>))}</>)
}

export default React.memo(VideoGallery)
