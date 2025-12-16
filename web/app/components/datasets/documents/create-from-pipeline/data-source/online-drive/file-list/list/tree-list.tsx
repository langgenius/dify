'use client'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import type { OnlineDriveFile } from '@/models/pipeline'
import { OnlineDriveFileType } from '@/models/pipeline'
import TreeItem from './tree-item'
import EmptyFolder from './empty-folder'
import EmptySearchResult from './empty-search-result'
import Loading from '@/app/components/base/loading'
import { RiLoader2Line } from '@remixicon/react'
import { useDataSourceStore } from '../../../store'
import {
  buildTreeMapFromFlatList,
  filterTreeBySearchKeywords,
  getDescendantFileIds,
  getFlattenedTreeList,
  getRootIds,
  toggleFolderExpand,
} from '../../tree-utils'

type TreeListProps = {
  fileList: OnlineDriveFile[]
  selectedFileIds: string[]
  keywords: string
  isLoading: boolean
  supportBatchUpload: boolean
  handleResetKeywords: () => void
  handleSelectFile: (file: OnlineDriveFile) => void
  handleOpenFolder: (file: OnlineDriveFile) => void
}

const TreeList = ({
  fileList,
  selectedFileIds,
  keywords,
  handleResetKeywords,
  handleSelectFile,
  handleOpenFolder,
  isLoading,
  supportBatchUpload,
}: TreeListProps) => {
  const anchorRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver>(null)
  const dataSourceStore = useDataSourceStore()
  const { treeMap, prefix, expandedFolderIds } = dataSourceStore.getState()

  // Build/update tree map when fileList changes
  const currentTreeMap = useMemo(() => {
    return buildTreeMapFromFlatList(fileList, prefix, treeMap, expandedFolderIds)
  }, [fileList, prefix, treeMap, expandedFolderIds])

  // Apply search filtering if keywords present
  const displayList = useMemo(() => {
    if (keywords) {
      const { matchedIds, autoExpandIds } = filterTreeBySearchKeywords(currentTreeMap, keywords)

      // Merge autoExpandIds with existing expandedFolderIds
      const mergedExpandedIds = new Set([...expandedFolderIds, ...autoExpandIds])

      // Update tree map with new expanded state
      const updatedTreeMap = { ...currentTreeMap }
      mergedExpandedIds.forEach((id) => {
        if (updatedTreeMap[id]) {
          updatedTreeMap[id] = {
            ...updatedTreeMap[id],
            isExpanded: true,
          }
        }
      })

      // Get root IDs and flatten, but only include matched items
      const rootIds = getRootIds(updatedTreeMap, prefix)
      const flatList = getFlattenedTreeList(updatedTreeMap, rootIds)
      return flatList.filter(item => matchedIds.has(item.id))
    }

    // No search: normal tree display
    const rootIds = getRootIds(currentTreeMap, prefix)
    return getFlattenedTreeList(currentTreeMap, rootIds)
  }, [currentTreeMap, prefix, keywords, expandedFolderIds])

  // Update store with current tree map
  useEffect(() => {
    const { setTreeMap } = dataSourceStore.getState()
    if (Object.keys(currentTreeMap).length > 0)
      setTreeMap(currentTreeMap)
  }, [currentTreeMap, dataSourceStore])

  // Infinite scroll observer
  useEffect(() => {
    if (anchorRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          const { setNextPageParameters, currentNextPageParametersRef, isTruncated }
            = dataSourceStore.getState()
          if (entries[0].isIntersecting && isTruncated.current && !isLoading)
            setNextPageParameters(currentNextPageParametersRef.current)
        },
        {
          rootMargin: '100px',
        },
      )
      observerRef.current.observe(anchorRef.current)
    }
    return () => observerRef.current?.disconnect()
  }, [anchorRef, isLoading, dataSourceStore])

  const handleToggleExpand = useCallback(
    (folderId: string) => {
      const { setTreeMap, setExpandedFolderIds } = dataSourceStore.getState()
      const { newTreeMap, newExpandedIds } = toggleFolderExpand(
        currentTreeMap,
        folderId,
        expandedFolderIds,
      )
      setTreeMap(newTreeMap)
      setExpandedFolderIds(newExpandedIds)
    },
    [currentTreeMap, expandedFolderIds, dataSourceStore],
  )

  const handleSelect = useCallback(
    (file: OnlineDriveFile) => {
      // For folders in tree view with multiple selection: bulk select descendants
      if (
        supportBatchUpload
        && (file.type === OnlineDriveFileType.folder || file.type === OnlineDriveFileType.bucket)
      ) {
        const descendantIds = getDescendantFileIds(currentTreeMap, file.id)

        // Check if folder is currently selected by checking if any descendant is selected
        const isAnyDescendantSelected = descendantIds.some(id => selectedFileIds.includes(id))

        // Update selection
        let newSelectedIds: string[]
        if (isAnyDescendantSelected) {
          // Deselect: remove all descendants
          newSelectedIds = selectedFileIds.filter(id => !descendantIds.includes(id))
        }
        else {
          // Select: add all descendants
          newSelectedIds = [...selectedFileIds, ...descendantIds]
        }

        // Call handleSelectFile with a mock file that represents bulk selection
        // We need to update selectedFileIds in the store directly
        const { setSelectedFileIds } = dataSourceStore.getState()
        setSelectedFileIds(newSelectedIds)
      }
      else {
        // Normal file selection
        handleSelectFile(file)
      }
    },
    [
      supportBatchUpload,
      currentTreeMap,
      selectedFileIds,
      handleSelectFile,
      dataSourceStore,
    ],
  )

  const isAllLoading = isLoading && fileList.length === 0 && keywords.length === 0
  const isPartialLoading = isLoading && fileList.length > 0
  const isEmptyFolder = !isLoading && fileList.length === 0 && keywords.length === 0
  const isSearchResultEmpty = !isLoading && fileList.length === 0 && keywords.length > 0

  return (
    <div className='grow overflow-hidden p-1 pt-0'>
      {isAllLoading && <Loading type='app' />}
      {isEmptyFolder && <EmptyFolder />}
      {isSearchResultEmpty && <EmptySearchResult onResetKeywords={handleResetKeywords} />}

      {displayList.length > 0 && (
        <div className='flex h-full flex-col gap-y-px overflow-y-auto rounded-[10px] bg-background-section px-1 py-1.5'>
          {displayList.map((treeItem) => {
            const isSelected = selectedFileIds.includes(treeItem.id)

            // For folders, check if any descendants are selected
            const canExpand
              = treeItem.hasChildren
              && (treeItem.type === OnlineDriveFileType.folder
                || treeItem.type === OnlineDriveFileType.bucket)

            return (
              <TreeItem
                key={treeItem.id}
                treeItem={treeItem}
                isSelected={isSelected}
                canExpand={canExpand}
                onSelect={handleSelect}
                onOpen={handleOpenFolder}
                onToggleExpand={handleToggleExpand}
                isMultipleChoice={supportBatchUpload}
              />
            )
          })}
          {isPartialLoading && (
            <div className='flex items-center justify-center py-2'>
              <RiLoader2Line className='animation-spin size-4 text-text-tertiary' />
            </div>
          )}
          <div ref={anchorRef} className='h-0' />
        </div>
      )}
    </div>
  )
}

export default React.memo(TreeList)
