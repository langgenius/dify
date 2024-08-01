'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { Word } from '../icons/src/vender/line/document'

type Props = {
  files: any[]
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

const DocumentGallery: FC<Props> = ({
  files,
}) => {
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')

  const imgNum = files.length
  const imgStyle = getWidthStyle(imgNum)
  return (

    <div>
      {files.map(item => (
        <div
          key={item._id}
          className="h-16 group relative mr-1 border-[0.5px] border-black/5 rounded-lg"
        >
          <div>
            <div className="flex h-16 bg-[#add8e6] rounded-lg">
              <div className="w-1/10 h-5  pl-1 pt-3 items-center">
                {/* Left column content */}
                <Word className="w-9 text-blue-500 items-center" />
              </div>
              <div className="w-9/10 pt-3 pr-3">
                {/* Right column content */}
                <p className='text-[13px]'>{item.file_name}</p>
                <p className="text-[10px]">
                  {item.file_size / 1000 || 0}KB
                </p>
              </div>
            </div>
          </div>

        </div>
      ))}
    </div>
  )
}

export default React.memo(DocumentGallery)
