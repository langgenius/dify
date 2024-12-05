import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  fileList: {
    varName: string
    list: FileEntity[]
  }[]
  isExpanded?: boolean
  noBorder?: boolean
  noPadding?: boolean
}

const FileListInLog = ({ fileList, isExpanded = false, noBorder = false, noPadding = false }: Props) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(isExpanded)
  const fullList = useMemo(() => {
    return fileList.reduce((acc: FileEntity[], { list }) => {
      return [...acc, ...list]
    }, [])
  }, [fileList])

  if (!fileList.length)
    return null

  return (
    <div className={cn('px-3 py-2', expanded && 'py-3', !noBorder && 'border-t border-divider-subtle', noPadding && '!p-0')}>
      <div className='flex justify-between gap-1'>
        {expanded && (
          <div className='grow py-1 text-text-secondary system-xs-semibold-uppercase cursor-pointer' onClick={() => setExpanded(!expanded)}>{t('appLog.runDetail.fileListLabel')}</div>
        )}
        {!expanded && (
          <div className='flex gap-1'>
            {fullList.map((file) => {
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
          {!expanded && <div className='text-text-tertiary system-xs-medium-uppercase'>{t('appLog.runDetail.fileListDetail')}</div>}
          <RiArrowRightSLine className={cn('w-4 h-4 text-text-tertiary', expanded && 'rotate-90')} />
        </div>
      </div>
      {expanded && (
        <div className='flex flex-col gap-3'>
          {fileList.map(item => (
            <div key={item.varName} className='flex flex-col gap-1 system-xs-regular'>
              <div className='py-1 text-text-tertiary '>{item.varName}</div>
              {item.list.map(file => (
                <FileItem
                  key={file.id}
                  file={file}
                  showDeleteAction={false}
                  showDownloadAction
                  canPreview
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default FileListInLog
