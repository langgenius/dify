import type { OnlineDriveFile } from '@/models/pipeline'
import { RiLoader2Line } from '@remixicon/react'
import * as React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useDataSourceStore } from '../../../store'
import EmptyFolder from './empty-folder'
import EmptySearchResult from './empty-search-result'
import Item from './item'

type FileListProps = {
  fileList: OnlineDriveFile[]
  selectedFileIds: string[]
  keywords: string
  isLoading: boolean
  supportBatchUpload: boolean
  handleResetKeywords: () => void
  handleSelectFile: (file: OnlineDriveFile) => void
  handleOpenFolder: (file: OnlineDriveFile) => void
}

const List = ({
  fileList,
  selectedFileIds,
  keywords,
  handleResetKeywords,
  handleSelectFile,
  handleOpenFolder,
  isLoading,
  supportBatchUpload,
}: FileListProps) => {
  const { t } = useTranslation()
  const anchorRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver>(null)
  const dataSourceStore = useDataSourceStore()

  useEffect(() => {
    if (anchorRef.current) {
      observerRef.current = new IntersectionObserver((entries) => {
        const { setNextPageParameters, currentNextPageParametersRef, isTruncated } = dataSourceStore.getState()
        if (entries[0].isIntersecting && isTruncated.current && !isLoading)
          setNextPageParameters(currentNextPageParametersRef.current)
      }, {
        rootMargin: '100px',
      })
      observerRef.current.observe(anchorRef.current)
    }
    return () => observerRef.current?.disconnect()
  }, [anchorRef, isLoading, dataSourceStore])

  const isAllLoading = isLoading && fileList.length === 0 && keywords.length === 0
  const isPartialLoading = isLoading && fileList.length > 0
  const isEmptyFolder = !isLoading && fileList.length === 0 && keywords.length === 0
  const isSearchResultEmpty = !isLoading && fileList.length === 0 && keywords.length > 0

  return (
    <div className="grow overflow-hidden p-1 pt-0">
      {
        isAllLoading && (
          <Loading type="app" />
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
        <div className="flex h-full flex-col gap-y-px overflow-y-auto rounded-[10px] bg-background-section px-1 py-1.5">
          {
            fileList.map((file) => {
              const isSelected = selectedFileIds.includes(file.id)
              return (
                <Item
                  key={file.id}
                  file={file}
                  isSelected={isSelected}
                  onSelect={handleSelectFile}
                  onOpen={handleOpenFolder}
                  isMultipleChoice={supportBatchUpload}
                />
              )
            })
          }
          {
            isPartialLoading && (
              <div
                className="flex items-center justify-center py-2"
                role="status"
                aria-live="polite"
                aria-label={t('loading', { ns: 'appApi' })}
              >
                <RiLoader2Line className="animation-spin size-4 text-text-tertiary" />
              </div>
            )
          }
          <div ref={anchorRef} className="h-0" />
        </div>
      )}
    </div>
  )
}

export default React.memo(List)
