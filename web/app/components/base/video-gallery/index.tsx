'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import cn from 'classnames'
import s from './style.module.css'
import VideoPreview from '@/app/components/base/image-uploader/video-preview'

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

const VideoGallery: FC<Props> = ({
  srcs,
}) => {
  const [videoPreviewUrl, setVideoPreviewUrl] = useState('')

  const videoNum = srcs.length
  const videoStyle = getWidthStyle(videoNum)

  return (
    <div className={cn(s[`img-${videoNum}`], 'flex flex-wrap')}>
      {/* TODO: support preview */}
      {srcs.map((src, index) => (
        // eslint-disable-next-line react/jsx-key
        <video controls title='preview'>
          <source
            src={src}
            key={index}
            className={s.item}
            style={videoStyle}
            onClick={() => setVideoPreviewUrl(src)}
          />
        </video>
      ))}
      {
        videoPreviewUrl && (
          <VideoPreview
            url={videoPreviewUrl}
            title='Preview'
            onCancel={() => setVideoPreviewUrl('')}
          />
        )
      }
    </div>
  )
}

export default React.memo(VideoGallery)

export const VideoGalleryTest = () => {
  const videoGallerySrcs = (() => {
    const srcs = []
    for (let i = 0; i < 6; i++)
      srcs.push('https://placekitten.com/360/360')

    return srcs
  })()
  return (
    <div className='space-y-2'>
      {videoGallerySrcs.map((_, index) => (
        <div key={index} className='p-4 pb-2 rounded-lg bg-[#D1E9FF80]'>
          <VideoGallery srcs={videoGallerySrcs.slice(0, index + 1)} />
        </div>
      ))}
    </div>
  )
}
