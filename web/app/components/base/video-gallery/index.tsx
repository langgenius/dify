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

const VideoGallery: React.FC<Props> = ({ srcs }) => {
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  const videoNum = srcs.length
  const videoStyle = getWidthStyle(videoNum)

  useEffect(() => {
    srcs.forEach((src, index) => {
      const video = videoRefs.current[index]!
      if (video && src) {
        if (!video.paused)
          video.pause()

        video.src = src
        video.play().catch(error => console.log(error))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcs.join(',')])

  return (
    <>
      {srcs.map((_, index) => (
        <video controls title='preview' key={`video_${_}`} style={videoStyle}
          ref={(ref) => { videoRefs.current[index] = ref as HTMLVideoElement }} />),
      )}
    </>
  )
}
export default React.memo(VideoGallery)
