'use client'
import React, { useEffect, useMemo, useRef } from 'react'

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
  const videoStyle = useMemo(() => getWidthStyle(videoNum), [videoNum])

  useEffect(() => {
    srcs.forEach((src, index) => {
      const video = videoRefs.current[index]
      if (video && src)
        video.src = src
    })
  }, [srcs])

  return (
    <>
      {srcs.map((src, index) => (
        <video
          controls
          key={`video_${src}`}
          style={videoStyle}
          ref={(ref) => { videoRefs.current[index] = ref }}
          aria-label={`Video ${index + 1}`}
        />
      ))}
    </>
  )
}
export default React.memo(VideoGallery)
