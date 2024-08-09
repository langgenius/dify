import React from 'react'
import AudioPlayer from './AudioPlayer'
import styles from './AudioPlayer.module.css'

type Props = {
  srcs: string[]
}

const AudioGallery: React.FC<Props> = ({ srcs }) => {
  return (
    <div className={styles.audioGallery}>
      {srcs.map((src, index) => (
        <AudioPlayer key={`audio_${index}`} src={src} />
      ))}
    </div>
  )
}

export default React.memo(AudioGallery)
