'use client'
import React, { useEffect, useRef } from 'react'

type Props = {
  srcs: string[]
}

const getWidthStyle = (imgNum: number) => {
  if (imgNum === 1) {
    return {
      maxWidth: '100%',
    }
  }

  if (imgNum === 2 || imgNum === 4) {
    return {
      width: 'calc(50% - 4px)',
    }
  }

  return {
    width: 'calc(33.3333% - 5.3333px)',
  }
}

const AudioGallery: React.FC<Props> = ({ srcs }) => {
  const audioRefs = useRef<(HTMLAudioElement | null)[]>([])
  const audioNum = srcs.length
  const audioStyle = getWidthStyle(audioNum)

  useEffect(() => {
    srcs.forEach((src, index) => {
      const audio = audioRefs.current[index]!
      if (audio && src) {
        if (!audio.paused)
          audio.pause()

        audio.src = src
        audio.play().catch(error => console.log(error))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcs.join(',')])

  return (
    <>
      {srcs.map((_, index) => (
        <audio controls title='preview' key={`audio_${_}`} style={audioStyle}
          ref={(ref) => { audioRefs.current[index] = ref as HTMLAudioElement }} />),
      )}
    </>
  )
}
export default React.memo(AudioGallery)
