import Checkbox from '@/app/components/base/checkbox'
import Radio from '@/app/components/base/radio/ui'
import type { OnlineDriveFile } from '@/models/pipeline'
import React, { useCallback } from 'react'
import FileIcon from './file-icon'
import { formatFileSize } from '@/utils/format'
import Tooltip from '@/app/components/base/tooltip'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'

type ItemProps = {
  file: OnlineDriveFile
  isSelected: boolean
  disabled?: boolean
  isMultipleChoice?: boolean
  onSelect: (file: OnlineDriveFile) => void
  onOpen: (file: OnlineDriveFile) => void
}

const Item = ({
  file,
  isSelected,
  disabled = false,
  isMultipleChoice = true,
  onSelect,
  onOpen,
}: ItemProps) => {
  const { t } = useTranslation()
  const isBucket = file.type === 'bucket'
  const isFolder = file.type === 'folder'

  const Wrapper = disabled ? Tooltip : React.Fragment

  const handleSelect = useCallback(() => {
    onSelect(file)
  }, [file, onSelect])

  const handleClickItem = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (disabled) return
    if (isBucket || isFolder)
      onOpen(file)
    onSelect(file)
  }, [disabled, file, isBucket, isFolder, onOpen, onSelect])

  return (
    <div
      className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-[3px] hover:bg-state-base-hover'
      onClick={handleClickItem}
    >
      {!isBucket && isMultipleChoice && (
        <Checkbox className='shrink-0' id={file.key} checked={isSelected} onCheck={handleSelect} />
      )}
      {!isBucket && !isMultipleChoice && (
        <Radio className='shrink-0' isChecked={isSelected} onCheck={handleSelect} />
      )}
      <Wrapper
        popupContent={t('datasetPipeline.onlineDrive.notSupportedFileType')}
        position='top-end'
        offset={{ mainAxis: 4, crossAxis: 104 }}
      >
        <div
          className={cn(
            'flex grow items-center gap-x-1 py-0.5',
            disabled && 'opacity-30',
          )}>
          <FileIcon type={file.type} fileName={file.key} className='shrink-0' />
          <span className='system-sm-medium grow text-text-secondary'>{file.key}</span>
          {!isFolder && file.size && (
            <span className='system-xs-regular shrink-0 text-text-tertiary'>{formatFileSize(file.size)}</span>
          )}
        </div>
      </Wrapper>
    </div>
  )
}

export default React.memo(Item)
