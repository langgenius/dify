'use client'
import type { CustomFile as File, FileItem } from '@/models/datasets'
import { RiDeleteBinLine, RiErrorWarningFill } from '@remixicon/react'
import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import DocumentFileIcon from '@/app/components/datasets/common/document-file-icon'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { formatFileSize, getFileExtension } from '@/utils/format'
import { PROGRESS_COMPLETE, PROGRESS_ERROR } from '../constants'

const SimplePieChart = dynamic(() => import('@/app/components/base/simple-pie-chart'), { ssr: false })

export type FileListItemProps = {
  fileItem: FileItem
  onPreview: (file: File) => void
  onRemove: (fileID: string) => void
}

const FileListItem = ({
  fileItem,
  onPreview,
  onRemove,
}: FileListItemProps) => {
  const { theme } = useTheme()
  const chartColor = useMemo(() => theme === Theme.dark ? '#5289ff' : '#296dff', [theme])

  const isUploading = fileItem.progress >= 0 && fileItem.progress < PROGRESS_COMPLETE
  const isError = fileItem.progress === PROGRESS_ERROR

  const handleClick = () => {
    if (fileItem.file?.id)
      onPreview(fileItem.file)
  }

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    onRemove(fileItem.fileID)
  }

  return (
    <div
      onClick={handleClick}
      className="flex h-12 max-w-[640px] items-center rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg text-xs leading-3 text-text-tertiary shadow-xs"
    >
      <div className="flex w-12 shrink-0 items-center justify-center">
        <DocumentFileIcon
          size="xl"
          className="shrink-0"
          name={fileItem.file.name}
          extension={getFileExtension(fileItem.file.name)}
        />
      </div>
      <div className="flex shrink grow flex-col gap-0.5">
        <div className="flex w-full">
          <div className="w-0 grow truncate text-sm leading-4 text-text-secondary">
            {fileItem.file.name}
          </div>
        </div>
        <div className="w-full truncate leading-3 text-text-tertiary">
          <span className="uppercase">{getFileExtension(fileItem.file.name)}</span>
          <span className="px-1 text-text-quaternary">·</span>
          <span>{formatFileSize(fileItem.file.size)}</span>
        </div>
      </div>
      <div className="flex w-16 shrink-0 items-center justify-end gap-1 pr-3">
        {isUploading && (
          <SimplePieChart
            percentage={fileItem.progress}
            stroke={chartColor}
            fill={chartColor}
            animationDuration={0}
          />
        )}
        {isError && (
          <RiErrorWarningFill className="size-4 text-text-destructive" />
        )}
        <span
          className="flex h-6 w-6 cursor-pointer items-center justify-center"
          onClick={handleRemove}
        >
          <RiDeleteBinLine className="size-4 text-text-tertiary" />
        </span>
      </div>
    </div>
  )
}

export default FileListItem
