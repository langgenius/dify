import React, { useState } from 'react'
import { RiArrowRightSLine } from '@remixicon/react'
import FileImageRender from './file-image-render'
import FileTypeIcon from './file-type-icon'
import FileItem from './file-uploader-in-attachment/file-item'
import type { FileEntity } from './types'
import {
  getFileAppearanceType,
} from './utils'
import Tooltip from '@/app/components/base/tooltip'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type Props = {
  fileList: FileEntity[]
}

const FileListInLog = ({ fileList }: Props) => {
  const [expanded, setExpanded] = useState(false)

  if (!fileList.length)
    return null
  return (
    <div className={cn('border-t border-divider-subtle px-3 py-2', expanded && 'py-3')}>
      <div className='flex justify-between gap-1'>
        {expanded && (
          <div></div>
        )}
        {!expanded && (
          <div className='flex'>
            {fileList.map((file) => {
              const { id, name, type, supportFileType, base64Url, url } = file
              const isImageFile = supportFileType === SupportUploadFileTypes.image
              return (
                <>
                  {isImageFile && (
                    <Tooltip
                      popupContent={name}
                    >
                      <div key={id}>
                        <FileImageRender
                          className='w-8 h-8'
                          imageUrl={base64Url || url || ''}
                        />
                      </div>
                    </Tooltip>
                  )}
                  {!isImageFile && (
                    <Tooltip
                      popupContent={name}
                    >
                      <div key={id} className='p-1.5 rounded-md bg-components-panel-on-panel-item-bg border-[0.5px] border-components-panel-border shadow-xs'>
                        <FileTypeIcon
                          type={getFileAppearanceType(name, type)}
                          size='md'
                        />
                      </div>
                    </Tooltip>
                  )}
                </>
              )
            })}
          </div>
        )}
        <div className='flex items-center gap-1 cursor-pointer' onClick={() => setExpanded(!expanded)}>
          {!expanded && <div className='text-text-tertiary system-xs-medium-uppercase'>DETAIL</div>}
          <RiArrowRightSLine className={cn('w-4 h-4 text-text-tertiary', expanded && 'rotate-90')} />
        </div>
      </div>
      {expanded && (
        <div className='flex flex-col gap-1'>
          {fileList.map(file => (
            <FileItem
              key={file.id}
              file={file}
              showDeleteAction={false}
              showDownloadAction
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default FileListInLog
