import type { NodeRendererProps } from 'react-arborist'
import type { TreeNodeData } from '@/app/components/workflow/skill/type'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Tree } from 'react-arborist'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Toast from '@/app/components/base/toast'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { ROOT_ID } from '@/app/components/workflow/skill/constants'
import TreeGuideLines from '@/app/components/workflow/skill/file-tree/tree/tree-guide-lines'
import { useSkillAssetTreeData } from '@/app/components/workflow/skill/hooks/file-tree/data/use-skill-asset-tree'
import { useSkillTreeUpdateEmitter } from '@/app/components/workflow/skill/hooks/file-tree/data/use-skill-tree-collaboration'
import { useCreateOperations } from '@/app/components/workflow/skill/hooks/file-tree/operations/use-create-operations'
import { findNodeById, toApiParentId } from '@/app/components/workflow/skill/utils/tree-utils'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useUploadFileWithPresignedUrl } from '@/service/use-app-asset'
import { cn } from '@/utils/classnames'

type FilePickerUploadModalProps = {
  isOpen: boolean
  onClose: () => void
  defaultFolderId?: string
}

type AddFileMode = 'create' | 'upload'

const buildFolderOnlyTree = (nodes: TreeNodeData[]): TreeNodeData[] => {
  return nodes
    .filter(node => node.node_type === 'folder')
    .map((node) => {
      const children = buildFolderOnlyTree(node.children)
      return {
        ...node,
        children,
      }
    })
}

type FolderPickerTreeNodeProps = NodeRendererProps<TreeNodeData> & {
  onSelectNode: (node: TreeNodeData) => void
}

const FolderPickerTreeNode = ({ node, style, dragHandle, onSelectNode }: FolderPickerTreeNodeProps) => {
  const isSelected = node.isSelected
  const hasChildren = node.data.children.length > 0

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    node.select()
    onSelectNode(node.data)
  }, [node, onSelectNode])

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    node.toggle()
  }, [node])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelectNode(node.data)
    }
  }, [node.data, onSelectNode])

  return (
    <div
      ref={dragHandle}
      style={style}
      role="treeitem"
      tabIndex={0}
      aria-selected={isSelected}
      aria-expanded={hasChildren ? node.isOpen : undefined}
      className={cn(
        'group relative flex h-6 cursor-pointer items-center gap-0 overflow-hidden rounded-md',
        'hover:bg-state-base-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
        isSelected && 'bg-state-base-active',
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <TreeGuideLines level={node.level} lineOffset={0} />
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <div className="flex size-4 shrink-0 items-center justify-center">
          {node.isOpen
            ? <span className="i-ri-folder-open-line size-4 text-text-accent" aria-hidden="true" />
            : <span className="i-ri-folder-line size-4 text-text-secondary" aria-hidden="true" />}
        </div>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px] font-normal leading-4',
            isSelected ? 'text-text-primary' : 'text-text-secondary',
          )}
        >
          {node.data.name}
        </span>
      </div>
      {hasChildren && (
        <button
          type="button"
          tabIndex={-1}
          onClick={handleToggle}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-r-md',
            'bg-transparent text-text-tertiary',
            'group-hover:bg-state-base-hover-subtle',
            'hover:bg-state-base-hover-subtle',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
          )}
        >
          {node.isOpen
            ? <span className="i-ri-arrow-down-s-line size-4" aria-hidden="true" />
            : <span className="i-ri-arrow-right-s-line size-4" aria-hidden="true" />}
        </button>
      )}
    </div>
  )
}

FolderPickerTreeNode.displayName = 'FolderPickerTreeNode'

const FilePickerUploadModal = ({
  isOpen,
  onClose,
  defaultFolderId,
}: FilePickerUploadModalProps) => {
  const { t } = useTranslation('workflow')
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const storeApi = useWorkflowStore()
  const { data: treeData } = useSkillAssetTreeData()
  const emitTreeUpdate = useSkillTreeUpdateEmitter()
  const uploadFile = useUploadFileWithPresignedUrl()
  const [mode, setMode] = useState<AddFileMode>('create')
  const [uploadFolderId, setUploadFolderId] = useState(defaultFolderId || ROOT_ID)
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false)
  const [folderPickerVersion, setFolderPickerVersion] = useState(0)
  const [fileName, setFileName] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)

  const treeNodes = useMemo(() => treeData?.children || [], [treeData?.children])
  const folderTreeNodes = useMemo(() => buildFolderOnlyTree(treeNodes), [treeNodes])
  const uploadInTreeData = useMemo<TreeNodeData[]>(() => {
    const workRoot: TreeNodeData = {
      id: ROOT_ID,
      node_type: 'folder',
      name: 'work',
      path: '/work',
      extension: '',
      size: 0,
      children: folderTreeNodes,
    }
    return [workRoot]
  }, [folderTreeNodes])
  const selectedFolderPath = useMemo(() => {
    if (uploadFolderId === ROOT_ID)
      return 'work'
    const selectedNode = findNodeById(uploadInTreeData, uploadFolderId)
    const selectedPath = selectedNode?.path.replace(/^\//, '')
    return selectedPath ? `work/${selectedPath}` : 'work'
  }, [uploadFolderId, uploadInTreeData])

  const effectiveUploadFolderId = useMemo(() => {
    if (uploadFolderId === ROOT_ID)
      return ROOT_ID
    const selectedNode = findNodeById(uploadInTreeData, uploadFolderId)
    return selectedNode
      ? uploadFolderId
      : ROOT_ID
  }, [uploadFolderId, uploadInTreeData])
  const folderPickerOpenState = useMemo(() => {
    return { [ROOT_ID]: true }
  }, [])

  const {
    fileInputRef,
    isCreating,
    handleFileChange: handleRawFileChange,
  } = useCreateOperations({
    parentId: toApiParentId(effectiveUploadFolderId),
    appId,
    storeApi,
    onClose: noop,
  })
  const isCreatingFile = uploadFile.isPending
  const isBusy = isCreating || isCreatingFile
  const trimmedFileName = fileName.trim()
  const canCreate = !!appId && !!trimmedFileName && !isBusy

  const handleClose = useCallback(() => {
    if (isBusy)
      return
    onClose()
  }, [isBusy, onClose])
  const handleFolderPickerOpenChange = useCallback((open: boolean) => {
    setIsFolderPickerOpen(open)
    if (open)
      setFolderPickerVersion(version => version + 1)
  }, [])
  const handleToggleFolderPicker = useCallback(() => {
    if (isBusy)
      return
    setIsFolderPickerOpen((open) => {
      const nextOpen = !open
      if (nextOpen)
        setFolderPickerVersion(version => version + 1)
      return nextOpen
    })
  }, [isBusy])
  const handleSelectUploadFolder = useCallback((node: TreeNodeData) => {
    setUploadFolderId(node.id)
    setIsFolderPickerOpen(false)
  }, [])

  const handleUploadFilesChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const hasSelectedFiles = (e.target.files?.length ?? 0) > 0
    await handleRawFileChange(e)
    if (hasSelectedFiles)
      onClose()
  }, [handleRawFileChange, onClose])
  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (isBusy || !appId)
      return
    setIsDragOver(false)
    const droppedFiles = Array.from(e.dataTransfer.files || [])
    if (!droppedFiles.length)
      return
    const transfer = new DataTransfer()
    droppedFiles.forEach(file => transfer.items.add(file))
    await handleUploadFilesChange({
      target: {
        files: transfer.files,
        value: '',
      },
    } as React.ChangeEvent<HTMLInputElement>)
  }, [appId, handleUploadFilesChange, isBusy])
  const handleCreateFile = useCallback(async () => {
    if (!canCreate)
      return

    try {
      const emptyBlob = new Blob([''], { type: 'text/plain' })
      const file = new File([emptyBlob], trimmedFileName)
      await uploadFile.mutateAsync({
        appId,
        file,
        parentId: toApiParentId(effectiveUploadFolderId),
      })
      emitTreeUpdate()
      onClose()
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.createError'),
      })
    }
  }, [appId, canCreate, effectiveUploadFolderId, emitTreeUpdate, onClose, t, trimmedFileName, uploadFile])
  const modeLabel = t('skillEditor.uploadIn')

  return (
    <Modal
      isShow={isOpen}
      onClose={handleClose}
      title={t('skillEditor.addFiles')}
      className="max-w-[360px]"
      closable={!isBusy}
      clickOutsideNotClose={isBusy}
    >
      <div className="-mx-6 mt-4 h-px bg-divider-subtle" />
      <div className="mt-4 space-y-4">
        <div className="flex items-center gap-2">
          <OptionCard
            className="flex-1"
            title={`${t('operation.create', { ns: 'common' })} ${t('skillSidebar.menu.newFile')}`}
            onSelect={() => setMode('create')}
            selected={mode === 'create'}
            disabled={isBusy}
          />
          <OptionCard
            className="flex-1"
            title={t('skillEditor.uploadFiles')}
            onSelect={() => setMode('upload')}
            selected={mode === 'upload'}
            disabled={isBusy}
          />
        </div>
        <div className="space-y-1">
          <div className="text-text-secondary system-sm-medium">{modeLabel}</div>
          <PortalToFollowElem
            open={isFolderPickerOpen}
            onOpenChange={handleFolderPickerOpenChange}
            placement="bottom-start"
            offset={{ mainAxis: 4 }}
            triggerPopupSameWidth
          >
            <PortalToFollowElemTrigger asChild>
              <button
                type="button"
                disabled={isBusy}
                onClick={handleToggleFolderPicker}
                className={cn(
                  'relative flex h-8 w-full items-center rounded-lg bg-components-input-bg-normal pl-3 pr-10 hover:bg-state-base-hover-alt',
                  isBusy && 'cursor-not-allowed opacity-60',
                )}
              >
                <span className="i-ri-folder-line mr-2 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                <span className="min-w-0 truncate text-left text-components-input-text-filled system-sm-regular">{selectedFolderPath}</span>
                <span className={cn(
                  'i-ri-arrow-down-s-line absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-quaternary transition-transform',
                  isFolderPickerOpen && 'rotate-180',
                )}
                />
              </button>
            </PortalToFollowElemTrigger>
            <PortalToFollowElemContent className="z-[1200]">
              <div
                className="max-h-[260px] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-lg backdrop-blur-sm"
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
              >
                <Tree<TreeNodeData>
                  key={folderPickerVersion}
                  data={uploadInTreeData}
                  idAccessor="id"
                  childrenAccessor="children"
                  width="100%"
                  className="pb-1"
                  height={240}
                  rowHeight={24}
                  indent={20}
                  overscanCount={5}
                  openByDefault={false}
                  initialOpenState={folderPickerOpenState}
                  disableDrag
                  disableDrop
                >
                  {(props: NodeRendererProps<TreeNodeData>) => (
                    <FolderPickerTreeNode
                      {...props}
                      onSelectNode={handleSelectUploadFolder}
                    />
                  )}
                </Tree>
              </div>
            </PortalToFollowElemContent>
          </PortalToFollowElem>
        </div>
        {mode === 'create' && (
          <div className="space-y-1">
            <div className="text-text-secondary system-sm-medium">{t('skillSidebar.fileNamePlaceholder')}</div>
            <Input
              value={fileName}
              onChange={e => setFileName(e.target.value)}
              placeholder={t('skillSidebar.fileNamePlaceholder') || ''}
              disabled={isBusy}
              onKeyDown={(e) => {
                if (e.key === 'Enter')
                  void handleCreateFile()
              }}
            />
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleUploadFilesChange}
        />
        {mode === 'upload' && (
          <div
            role="button"
            tabIndex={0}
            className={cn(
              'flex h-12 cursor-pointer items-center justify-center gap-1 rounded-xl border border-dashed text-text-secondary',
              isDragOver ? 'border-components-button-primary-border bg-state-accent-hover' : 'border-divider-subtle bg-components-panel-bg',
              isBusy && 'cursor-not-allowed opacity-60',
            )}
            onClick={() => {
              if (!isBusy && appId)
                fileInputRef.current?.click()
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (!isBusy)
                setIsDragOver(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              setIsDragOver(false)
            }}
            onDrop={handleDrop}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !isBusy && appId)
                fileInputRef.current?.click()
            }}
          >
            <span className="i-ri-upload-cloud-line size-4 text-text-tertiary" aria-hidden="true" />
            <span className="system-sm-regular">{t('skillSidebar.dropTip')}</span>
            <span className="text-text-accent system-sm-medium">{t('skill.startTab.importModal.browseFiles')}</span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={handleClose} disabled={isBusy}>
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          {mode === 'create'
            ? (
                <Button
                  variant="primary"
                  onClick={handleCreateFile}
                  disabled={!canCreate}
                  loading={isCreatingFile}
                >
                  {t('operation.create', { ns: 'common' })}
                </Button>
              )
            : (
                <Button
                  variant="primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!appId || isBusy}
                  loading={isCreating}
                >
                  {t('skillEditor.uploadFiles')}
                </Button>
              )}
        </div>
      </div>
    </Modal>
  )
}

export default React.memo(FilePickerUploadModal)
