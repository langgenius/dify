import type { Item } from '@/app/components/base/select'
import type { TreeNodeData } from '@/app/components/workflow/skill/type'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import { SimpleSelect } from '@/app/components/base/select'
import Toast from '@/app/components/base/toast'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { ROOT_ID } from '@/app/components/workflow/skill/constants'
import { useSkillAssetTreeData } from '@/app/components/workflow/skill/hooks/file-tree/data/use-skill-asset-tree'
import { useSkillTreeUpdateEmitter } from '@/app/components/workflow/skill/hooks/file-tree/data/use-skill-tree-collaboration'
import { useCreateOperations } from '@/app/components/workflow/skill/hooks/file-tree/operations/use-create-operations'
import { toApiParentId } from '@/app/components/workflow/skill/utils/tree-utils'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useUploadFileWithPresignedUrl } from '@/service/use-app-asset'
import { cn } from '@/utils/classnames'

type FilePickerUploadModalProps = {
  isOpen: boolean
  onClose: () => void
  defaultFolderId?: string
}

type AddFileMode = 'create' | 'upload'
type FolderOption = Item & {
  pathLabel: string
  depth: number
  hasChildren: boolean
}

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
  const [fileName, setFileName] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)

  const treeNodes = useMemo(() => treeData?.children || [], [treeData?.children])
  const folderOptions = useMemo<FolderOption[]>(() => {
    const options: FolderOption[] = [{
      value: ROOT_ID,
      name: t('skillSidebar.rootFolder'),
      pathLabel: t('skillSidebar.rootFolder'),
      depth: 0,
      hasChildren: true,
    }]

    const travelFolders = (nodes: TreeNodeData[]) => {
      nodes.forEach((node) => {
        if (node.node_type !== 'folder')
          return

        const folderPath = node.path.replace(/^\//, '') || node.name
        const depth = Math.max(0, folderPath.split('/').length - 1)
        options.push({
          value: node.id,
          name: node.name,
          pathLabel: folderPath,
          depth,
          hasChildren: node.children.some(child => child.node_type === 'folder'),
        })
        if (node.children.length > 0)
          travelFolders(node.children)
      })
    }
    travelFolders(treeNodes)
    return options
  }, [t, treeNodes])

  const effectiveUploadFolderId = useMemo(() => {
    return folderOptions.some(item => item.value === uploadFolderId)
      ? uploadFolderId
      : ROOT_ID
  }, [folderOptions, uploadFolderId])
  const selectedFolderOption = useMemo(() => {
    return folderOptions.find(item => item.value === effectiveUploadFolderId) || folderOptions[0]
  }, [effectiveUploadFolderId, folderOptions])

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
          <SimpleSelect
            items={folderOptions as Item[]}
            defaultValue={effectiveUploadFolderId}
            notClearable
            className="h-8 rounded-lg bg-components-input-bg-normal pl-3 pr-10 hover:bg-state-base-hover-alt"
            optionWrapClassName="max-h-[260px] rounded-xl bg-components-panel-bg-blur"
            optionClassName="pr-3"
            renderTrigger={(selectedItem, open) => {
              const currentOption = selectedItem as FolderOption | null
              const label = currentOption?.pathLabel || selectedFolderOption?.pathLabel || t('skillSidebar.rootFolder')
              return (
                <div className="relative flex h-8 items-center rounded-lg bg-components-input-bg-normal pl-3 pr-10 hover:bg-state-base-hover-alt">
                  <span className="i-ri-folder-line mr-2 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="min-w-0 truncate text-left text-components-input-text-filled system-sm-regular">{label}</span>
                  <span className={cn(
                    'i-ri-arrow-down-s-line absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-quaternary transition-transform',
                    open && 'rotate-180',
                  )}
                  />
                </div>
              )
            }}
            renderOption={({ item }) => {
              const option = item as FolderOption
              return (
                <div className="flex items-center gap-2">
                  <span style={{ width: `${option.depth * 16}px` }} aria-hidden="true" />
                  <span className="i-ri-folder-line size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {option.hasChildren && <span className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary" aria-hidden="true" />}
                </div>
              )
            }}
            onSelect={item => setUploadFolderId(String(item.value))}
          />
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
