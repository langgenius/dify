import React from 'react'
import VideoPlayer from './VideoPlayer'

type Props = {
  srcs: string[]
}

const VideoGallery: React.FC<Props> = ({ srcs }) => {
  return (<><br/>{srcs.map((src, index) => (<><br/><VideoPlayer key={`audio_${index}`} src={src}/></>))}</>)
}

export default React.memo(VideoGallery)
