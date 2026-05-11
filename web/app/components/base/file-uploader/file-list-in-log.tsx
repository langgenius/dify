import type { FileEntity } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiArrowRightSLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import FileImageRender from './file-image-render'
import FileTypeIcon from './file-type-icon'
import FileItem from './file-uploader-in-attachment/file-item'
import {
  getFileAppearanceType,
} from './utils'

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
    <div className={cn('px-3 py-2', expanded && 'py-3', !noBorder && 'border-t border-divider-subtle', noPadding && 'p-0!')}>
      <div className="flex justify-between gap-1">
        {expanded && (
          <button
            type="button"
            className="grow cursor-pointer border-none bg-transparent px-0 py-1 text-left system-xs-semibold-uppercase text-text-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            onClick={() => setExpanded(!expanded)}
          >
            {t('runDetail.fileListLabel', { ns: 'appLog' })}
          </button>
        )}
        {!expanded && (
          <div className="flex gap-1">
            {fullList.map((file) => {
              const { id, name, type, supportFileType, base64Url, url } = file
              const isImageFile = supportFileType === SupportUploadFileTypes.image
              return (
                <>
                  {isImageFile && (
                    <Tooltip>
                      <TooltipTrigger
                        render={(
                          <div key={id}>
                            <FileImageRender
                              className="h-8 w-8"
                              imageUrl={base64Url || url || ''}
                            />
                          </div>
                        )}
                      />
                      <TooltipContent>
                        {name}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {!isImageFile && (
                    <Tooltip>
                      <TooltipTrigger
                        render={(
                          <div key={id} className="rounded-md border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1.5 shadow-xs">
                            <FileTypeIcon
                              type={getFileAppearanceType(name, type)}
                              size="lg"
                            />
                          </div>
                        )}
                      />
                      <TooltipContent>
                        {name}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </>
              )
            })}
          </div>
        )}
        <button
          type="button"
          aria-label={t('runDetail.fileListDetail', { ns: 'appLog' })}
          className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-left focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          onClick={() => setExpanded(!expanded)}
        >
          {!expanded && <div className="system-xs-medium-uppercase text-text-tertiary">{t('runDetail.fileListDetail', { ns: 'appLog' })}</div>}
          <RiArrowRightSLine className={cn('h-4 w-4 text-text-tertiary', expanded && 'rotate-90')} aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="flex flex-col gap-3">
          {fileList.map(item => (
            <div key={item.varName} className="flex flex-col gap-1 system-xs-regular">
              <div className="py-1 text-text-tertiary">{item.varName}</div>
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
