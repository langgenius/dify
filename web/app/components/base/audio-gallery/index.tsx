import React from 'react'
import AudioPlayer from './AudioPlayer'

type Props = {
  srcs: string[]
}

const AudioGallery: React.FC<Props> = ({ srcs }) => {
  return (<><br/>{srcs.map((src, index) => (<AudioPlayer key={`audio_${index}`} src={src}/>))}</>)
}

export default React.memo(AudioGallery)
