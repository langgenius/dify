import type { OnlineDriveFile } from '@/models/pipeline'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Radio } from '@langgenius/dify-ui/radio'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { name, type, size } = file

  const isBucket = type === 'bucket'
  const isFolder = type === 'folder'

  const disabledTip = t($ => $['onlineDrive.notSupportedFileType'], { ns: 'datasetPipeline' })

  const handleCheckboxSelect = useCallback(() => {
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
        <span onClick={event => event.stopPropagation()}>
          <Checkbox
            className="shrink-0"
            disabled={disabled}
            checked={isSelected}
            aria-label={name}
            onCheckedChange={() => handleCheckboxSelect()}
          />
        </span>
      )}
      {!isBucket && !isMultipleChoice && (
        <span onClick={event => event.stopPropagation()}>
          <Radio
            className="shrink-0"
            disabled={disabled}
            value={file.id}
            aria-label={name}
          />
        </span>
      )}
      {disabled
        ? (
            <Popover>
              <PopoverTrigger
                openOnHover
                aria-label={disabledTip}
                className="flex grow items-center gap-x-1 overflow-hidden border-0 bg-transparent p-0 py-0.5 text-left opacity-30"
              >
                <FileIcon type={type} fileName={name} className="shrink-0 transform-gpu" />
                <span
                  className="grow truncate system-sm-medium text-text-secondary"
                  title={name}
                >
                  {name}
                </span>
                {!isFolder && typeof size === 'number' && (
                  <span className="shrink-0 system-xs-regular text-text-tertiary">{formatFileSize(size)}</span>
                )}
              </PopoverTrigger>
              <PopoverContent placement="top-end" popupClassName="px-3 py-2 system-xs-regular text-text-tertiary">
                {disabledTip}
              </PopoverContent>
            </Popover>
          )
        : (
            <div className="flex grow items-center gap-x-1 overflow-hidden py-0.5">
              <FileIcon type={type} fileName={name} className="shrink-0 transform-gpu" />
              <span
                className="grow truncate system-sm-medium text-text-secondary"
                title={name}
              >
                {name}
              </span>
              {!isFolder && typeof size === 'number' && (
                <span className="shrink-0 system-xs-regular text-text-tertiary">{formatFileSize(size)}</span>
              )}
            </div>
          )}
    </div>
  )
}

export default React.memo(Item)
