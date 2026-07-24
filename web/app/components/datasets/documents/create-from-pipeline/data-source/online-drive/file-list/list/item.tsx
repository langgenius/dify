import type { Placement } from '@floating-ui/react'
import type { OnlineDriveFile } from '@/models/pipeline'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import Radio from '@/app/components/base/radio/ui'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'
import { formatFileSize } from '@/utils/format'
import FileIcon from './file-icon'

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
  const { id, name, type, size } = file

  const isBucket = type === 'bucket'
  const isFolder = type === 'folder'

  const Wrapper = disabled ? Tooltip : React.Fragment
  const wrapperProps = disabled
    ? {
        popupContent: t('onlineDrive.notSupportedFileType', { ns: 'datasetPipeline' }),
        position: 'top-end' as Placement,
        offset: { mainAxis: 4, crossAxis: -104 },
      }
    : {}

  const handleSelect = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    onSelect(file)
  }, [file, onSelect])

  const handleClickItem = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (disabled)
      return
    if (isBucket || isFolder) {
      onOpen(file)
      return
    }
    onSelect(file)
  }, [disabled, file, isBucket, isFolder, onOpen, onSelect])

  return (
    <div
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-[3px] hover:bg-state-base-hover"
      onClick={handleClickItem}
    >
      {!isBucket && isMultipleChoice && (
        <Checkbox
          className="shrink-0"
          disabled={disabled}
          id={id}
          checked={isSelected}
          onCheck={handleSelect}
        />
      )}
      {!isBucket && !isMultipleChoice && (
        <Radio
          className="shrink-0"
          disabled={disabled}
          isChecked={isSelected}
          onCheck={handleSelect}
        />
      )}
      <Wrapper
        {...wrapperProps}
      >
        <div
          className={cn(
            'flex grow items-center gap-x-1 overflow-hidden py-0.5',
            disabled && 'opacity-30',
          )}
        >
          <FileIcon type={type} fileName={name} className="shrink-0 transform-gpu" />
          <span
            className="system-sm-medium grow truncate text-text-secondary"
            title={name}
          >
            {name}
          </span>
          {!isFolder && typeof size === 'number' && (
            <span className="system-xs-regular shrink-0 text-text-tertiary">{formatFileSize(size)}</span>
          )}
        </div>
      </Wrapper>
    </div>
  )
}

export default React.memo(Item)
