'use client'
import type { OnlineDriveFile } from '@/models/pipeline'
import { RiLoader2Line } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import Loading from '@/app/components/base/loading'
import { OnlineDriveFileType } from '@/models/pipeline'
import { useDataSourceStoreWithSelector } from '../../../store'
import {
  buildTreeMapFromFlatList,
  filterTreeBySearchKeywords,
  getDescendantFileIds,
  getFlattenedTreeList,
  getRootIds,
  toggleFolderExpand,
} from '../../tree-utils'
import EmptyFolder from './empty-folder'
import EmptySearchResult from './empty-search-result'
import TreeItem from './tree-item'

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

  const { prefix, expandedFolderIds, setExpandedFolderIds, setSelectedFileIds, setNextPageParameters, currentNextPageParametersRef, isTruncated } = useDataSourceStoreWithSelector(
    useShallow(state => ({
      prefix: state.prefix,
      expandedFolderIds: state.expandedFolderIds,
      setExpandedFolderIds: state.setExpandedFolderIds,
      setSelectedFileIds: state.setSelectedFileIds,
      setNextPageParameters: state.setNextPageParameters,
      currentNextPageParametersRef: state.currentNextPageParametersRef,
      isTruncated: state.isTruncated,
    })),
  )

  // Build tree map from fileList (not stored in state to avoid circular dependencies)
  const currentTreeMap = useMemo(() => {
    return buildTreeMapFromFlatList(fileList, prefix, {}, expandedFolderIds)
  }, [fileList, prefix, expandedFolderIds])

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

  // Infinite scroll observer
  useEffect(() => {
    if (anchorRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
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
  }, [anchorRef, isLoading, isTruncated, currentNextPageParametersRef, setNextPageParameters])

  const handleToggleExpand = useCallback(
    (folderId: string) => {
      const { newExpandedIds } = toggleFolderExpand(
        currentTreeMap,
        folderId,
        expandedFolderIds,
      )
      setExpandedFolderIds(newExpandedIds)
    },
    [currentTreeMap, expandedFolderIds, setExpandedFolderIds],
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
          // Select: add all descendants (use Set to prevent duplicates)
          newSelectedIds = Array.from(new Set([...selectedFileIds, ...descendantIds]))
        }

        // Directly update selectedFileIds in the store for bulk selection/deselection
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
      setSelectedFileIds,
    ],
  )

  const isAllLoading = isLoading && fileList.length === 0 && keywords.length === 0
  const isPartialLoading = isLoading && fileList.length > 0
  const isEmptyFolder = !isLoading && fileList.length === 0 && keywords.length === 0
  const isSearchResultEmpty = !isLoading && fileList.length === 0 && keywords.length > 0

  return (
    <div className="grow overflow-hidden p-1 pt-0">
      {isAllLoading && <Loading type="app" />}
      {isEmptyFolder && <EmptyFolder />}
      {isSearchResultEmpty && <EmptySearchResult onResetKeywords={handleResetKeywords} />}

      {displayList.length > 0 && (
        <div className="flex h-full flex-col gap-y-px overflow-y-auto rounded-[10px] bg-background-section px-1 py-1.5">
          {displayList.map((treeItem) => {
            const isSelected = selectedFileIds.includes(treeItem.id)

            return (
              <TreeItem
                key={treeItem.id}
                treeItem={treeItem}
                isSelected={isSelected}
                canExpand={treeItem.hasChildren}
                onSelect={handleSelect}
                onOpen={handleOpenFolder}
                onToggleExpand={handleToggleExpand}
                isMultipleChoice={supportBatchUpload}
              />
            )
          })}
          {isPartialLoading && (
            <div className="flex items-center justify-center py-2">
              <RiLoader2Line className="size-4 animate-spin text-text-tertiary" />
            </div>
          )}
          <div ref={anchorRef} className="h-0" />
        </div>
      )}
    </div>
  )
}

export default React.memo(TreeList)
