import React, { useMemo } from 'react'
import type { OnlineDriveFile } from '@/models/pipeline'
import Item from './item'
import EmptyFolder from './empty-folder'
import EmptySearchResult from './empty-search-result'
import Loading from '@/app/components/base/loading'
import { RiLoader2Line } from '@remixicon/react'
import { useFileSupportTypes } from '@/service/use-common'
import { isFile } from '../../utils'
import { getFileExtension } from './utils'

type FileListProps = {
  fileList: OnlineDriveFile[]
  selectedFileList: string[]
  keywords: string
  isInPipeline: boolean
  isLoading: boolean
  handleResetKeywords: () => void
  handleSelectFile: (file: OnlineDriveFile) => void
  handleOpenFolder: (file: OnlineDriveFile) => void
}

const List = ({
  fileList,
  selectedFileList,
  keywords,
  handleResetKeywords,
  handleSelectFile,
  handleOpenFolder,
  isInPipeline,
  isLoading,
}: FileListProps) => {
  const isAllLoading = isLoading && fileList.length === 0 && keywords.length === 0
  const isPartLoading = isLoading && fileList.length > 0
  const isEmptyFolder = !isLoading && fileList.length === 0 && keywords.length === 0
  const isSearchResultEmpty = !isLoading && fileList.length === 0 && keywords.length > 0
  const { data: supportFileTypesRes } = useFileSupportTypes()
  const supportedFileTypes = useMemo(() => {
    if (!supportFileTypesRes) return []
    return Array.from(new Set(supportFileTypesRes.allowed_extensions.map(item => item.toLowerCase())))
  }, [supportFileTypesRes])

  return (
    <div className='grow overflow-hidden p-1 pt-0'>
      {
        isAllLoading && (
          <Loading type='app' />
        )
      }
      {
        isEmptyFolder && (
          <EmptyFolder />
        )
      }
      {
        isSearchResultEmpty && (
          <EmptySearchResult onResetKeywords={handleResetKeywords} />
        )
      }
      {fileList.length > 0 && (
        <div className='flex h-full flex-col gap-y-px overflow-y-auto rounded-[10px] bg-background-section px-1 py-1.5'>
          {
            fileList.map((file) => {
              const isSelected = selectedFileList.includes(file.key)
              const extension = getFileExtension(file.key)
              const disabled = isFile(file.key) && !supportedFileTypes.includes(extension)
              return (
                <Item
                  key={file.key}
                  file={file}
                  isSelected={isSelected}
                  disabled={disabled}
                  onSelect={handleSelectFile}
                  onOpen={handleOpenFolder}
                  isMultipleChoice={!isInPipeline}
                />
              )
            })
          }
          {
            isPartLoading && (
              <div className='flex items-center justify-center py-2'>
                <RiLoader2Line className='animation-spin size-4 text-text-tertiary' />
              </div>
            )
          }
        </div>
      )}
    </div>
  )
}

export default React.memo(List)
