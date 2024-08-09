import React from 'react'
import VideoPlayer from './VideoPlayer'
import styles from './VideoPlayer.module.css'

type Props = {
  srcs: string[]
}

const VideoGallery: React.FC<Props> = ({ srcs }) => {
  return (
    <div className={styles.audioGallery}>
      {srcs.map((src, index) => (
        <VideoPlayer key={`audio_${index}`} src={src} />
      ))}
    </div>
  )
}

export default React.memo(VideoGallery)
