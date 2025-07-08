import React, { useEffect, useMemo, useRef } from 'react'
import { type OnlineDriveFile, OnlineDriveFileType } from '@/models/pipeline'
import Item from './item'
import EmptyFolder from './empty-folder'
import EmptySearchResult from './empty-search-result'
import Loading from '@/app/components/base/loading'
import { RiLoader2Line } from '@remixicon/react'
import { useFileSupportTypes } from '@/service/use-common'
import { getFileExtension } from './utils'
import { useDataSourceStore } from '../../../store'

type FileListProps = {
  fileList: OnlineDriveFile[]
  selectedFileList: string[]
  keywords: string
  isInPipeline: boolean
  isTruncated: boolean
  isLoading: boolean
  handleResetKeywords: () => void
  handleSelectFile: (file: OnlineDriveFile) => void
  handleOpenFolder: (file: OnlineDriveFile) => void
  getOnlineDriveFiles: (params: {
    prefix?: string[]
    bucket?: string
    startAfter?: string
    fileList?: OnlineDriveFile[]
  }) => void
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
  isTruncated,
  getOnlineDriveFiles,
}: FileListProps) => {
  const anchorRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver>()
  const dataSourceStore = useDataSourceStore()

  useEffect(() => {
    if (anchorRef.current) {
      observerRef.current = new IntersectionObserver((entries) => {
        const { setStartAfter } = dataSourceStore.getState()
        if (entries[0].isIntersecting && isTruncated && !isLoading) {
          setStartAfter(fileList[fileList.length - 1].key)
          getOnlineDriveFiles({ startAfter: fileList[fileList.length - 1].key })
        }
      }, {
        rootMargin: '100px',
      })
      observerRef.current.observe(anchorRef.current)
    }
    return () => observerRef.current?.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorRef])

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
              const disabled = file.type === OnlineDriveFileType.file && !supportedFileTypes.includes(extension)
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
          <div ref={anchorRef} className='h-0' />
        </div>
      )}
    </div>
  )
}

export default React.memo(List)
