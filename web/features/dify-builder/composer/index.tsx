import type { FileUpload } from '@/app/components/base/features/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useId, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import TextareaAutosize from 'react-textarea-autosize'
import { FileList, FileUploaderInChatInput } from '@/app/components/base/file-uploader'
import { useFile } from '@/app/components/base/file-uploader/hooks'
import { useFileStore, useStore as useUploadFiles } from '@/app/components/base/file-uploader/store'
import { TransferMethod } from '@/types/app'
import { useDifyBuilderLocale } from '../i18n/use-builder-locale'
import DifyBuilderModelSelector from '../model/selector'
import { DifyBuilderModelStatus } from '../model/status'
import { useDifyBuilderModel } from '../model/use-model'
import {
  difyBuilderMaterialControlAtom,
  difyBuilderSessionErrorCodeAtom,
  difyBuilderSessionViewAtom,
  difyBuilderTaskControlAtom,
} from '../session/state'
import {
  difyBuilderCanAddMaterialAtom,
  difyBuilderCanComposeAtom,
  difyBuilderCanControlTaskAtom,
  difyBuilderCanSendDraftAtom,
  difyBuilderCanvasReadyAtom,
  difyBuilderControlTaskAtom,
  difyBuilderDraftAtom,
  difyBuilderInteractionBusyAtom,
  difyBuilderRuntimeAtom,
  difyBuilderSendDraftAtom,
  difyBuilderTaskControlOperationAtom,
} from '../state'
import { DifyBuilderAttachmentScope } from './attachment-scope'

const COMPOSITION_END_DELAY = 50

const DifyBuilderPromptInput = ({ descriptionId }: { descriptionId?: string }) => {
  const locale = useDifyBuilderLocale()
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const [draft, setDraft] = useAtom(difyBuilderDraftAtom)
  const canCompose = useAtomValue(difyBuilderCanComposeAtom)
  const interactionBusy = useAtomValue(difyBuilderInteractionBusyAtom)
  const isComposingRef = useRef(false)
  const compositionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const placeholder = canCompose
    ? t(($) => $.messagePlaceholder, { ns: 'difyBuilder' })
    : interactionBusy
      ? t(($) => $.workingPlaceholder, { ns: 'difyBuilder' })
      : t(($) => $.inputUnavailable, { ns: 'difyBuilder' })

  useEffect(() => {
    return () => {
      if (compositionEndTimerRef.current) clearTimeout(compositionEndTimerRef.current)
    }
  }, [])

  return (
    <TextareaAutosize
      value={draft}
      minRows={2}
      maxRows={8}
      disabled={!canCompose}
      aria-label={t(($) => $.messagePlaceholder, { ns: 'difyBuilder' })}
      aria-describedby={descriptionId}
      placeholder={placeholder}
      className="block w-full resize-none overflow-y-auto overscroll-contain bg-transparent px-2 py-1 text-sm leading-5 tracking-[-0.07px] text-text-primary caret-[#295EFF] outline-hidden placeholder:text-text-placeholder disabled:cursor-not-allowed"
      onChange={(event) => setDraft(event.currentTarget.value)}
      onCompositionStart={() => {
        if (compositionEndTimerRef.current) clearTimeout(compositionEndTimerRef.current)
        compositionEndTimerRef.current = null
        isComposingRef.current = true
      }}
      onCompositionEnd={() => {
        compositionEndTimerRef.current = setTimeout(() => {
          compositionEndTimerRef.current = null
          isComposingRef.current = false
        }, COMPOSITION_END_DELAY)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.shiftKey || !draft.trim()) return
        if (event.nativeEvent.isComposing || isComposingRef.current) return
        event.preventDefault()
        event.currentTarget.form?.requestSubmit()
      }}
    />
  )
}

const DifyBuilderComposerAction = ({
  hasModel,
  descriptionId,
  filesReady,
  hasFiles,
  attachmentsOnly,
}: {
  hasModel: boolean
  descriptionId?: string
  filesReady: boolean
  hasFiles: boolean
  attachmentsOnly: boolean
}) => {
  const locale = useDifyBuilderLocale()
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const canSendDraft = useAtomValue(difyBuilderCanSendDraftAtom)
  const canAddMaterial = useAtomValue(difyBuilderCanAddMaterialAtom)
  const canSend =
    hasModel && filesReady && (hasFiles ? canAddMaterial : !attachmentsOnly && canSendDraft)
  const canControl = useAtomValue(difyBuilderCanControlTaskAtom)
  const operation = useAtomValue(difyBuilderTaskControlOperationAtom)
  const control = useAtomValue(difyBuilderTaskControlAtom)
  const controlTask = useSetAtom(difyBuilderControlTaskAtom)
  const pending = control !== null && control.phase !== 'unknown'
  const label =
    operation === 'stop'
      ? t(($) => $['taskControl.stop'])
      : operation === 'resume'
        ? t(($) => $['taskControl.resume'])
        : t(($) => $.messageSend)
  const icon = pending
    ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
    : operation === 'stop'
      ? 'i-ri-stop-fill'
      : operation === 'resume'
        ? 'i-ri-play-fill'
        : 'i-ri-send-plane-2-fill'

  if (attachmentsOnly && !hasFiles) return null

  return (
    <div className="flex items-center gap-1">
      {operation && hasFiles && (
        <IconButton
          type="submit"
          size="lg"
          variant="primary"
          disabled={!canSend}
          aria-label={t(($) => $.messageSend)}
          aria-describedby={descriptionId}
        >
          <span aria-hidden className="i-ri-send-plane-2-fill size-4" />
        </IconButton>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <IconButton
              type={operation ? 'button' : 'submit'}
              size="lg"
              variant="primary"
              disabled={operation ? !canControl : !canSend}
              focusableWhenDisabled={pending}
              aria-label={label}
              aria-describedby={descriptionId}
              onClick={
                operation
                  ? (event) => {
                      // A fast Resume can turn this same button into Stop before
                      // the second click of a double-click reaches it.
                      if (event.detail > 1) return
                      void controlTask()
                    }
                  : undefined
              }
            >
              <span aria-hidden className={`${icon} size-4`} />
            </IconButton>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}

const DraftFileList = ({
  files,
  fileConfig,
  editable,
}: {
  files: FileEntity[]
  fileConfig: FileUpload
  editable: boolean
}) => {
  const { handleRemoveFile, handleReUploadFile } = useFile(fileConfig)
  const canAddMaterial = useAtomValue(difyBuilderCanAddMaterialAtom)
  return (
    <FileList
      files={files}
      onRemove={handleRemoveFile}
      onReUpload={canAddMaterial ? handleReUploadFile : undefined}
      showDeleteAction={editable}
      showDownloadAction={false}
      canPreview={false}
    />
  )
}

const DifyBuilderComposerContent = ({ attachmentsOnly = false }: { attachmentsOnly?: boolean }) => {
  const locale = useDifyBuilderLocale()
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const sendDraft = useSetAtom(difyBuilderSendDraftAtom)
  const filesStore = useFileStore()
  const uploadFiles = useUploadFiles((state) => state.files)
  const view = useAtomValue(difyBuilderSessionViewAtom)
  const files = view?.conversation_cleared ? [] : uploadFiles
  const canAddMaterial = useAtomValue(difyBuilderCanAddMaterialAtom)
  const material = useAtomValue(difyBuilderMaterialControlAtom)
  const runtime = useAtomValue(difyBuilderRuntimeAtom)
  const fileConfig = useMemo<FileUpload>(
    () => ({
      enabled: true,
      allowed_file_types: ['custom'],
      allowed_file_extensions: ['.txt', '.md', '.markdown', '.csv', '.pdf', '.xlsx'],
      allowed_file_upload_methods: [TransferMethod.local_file],
      number_limits: 5,
      ...(runtime?.fileUploadConfig
        ? {
            fileUploadConfig: {
              ...runtime.fileUploadConfig,
              file_size_limit: Math.min(10, runtime.fileUploadConfig.file_size_limit),
            },
          }
        : {}),
    }),
    [runtime?.fileUploadConfig],
  )
  const filesReady =
    files.length <= 5 &&
    files.every(
      (file) =>
        file.transferMethod === TransferMethod.local_file &&
        Boolean(file.uploadedId) &&
        file.progress === 100,
    )
  const modelState = useDifyBuilderModel()
  const { model } = modelState
  const hasModel = model !== null
  const rejected = useAtomValue(difyBuilderSessionErrorCodeAtom) === 'model_unavailable'
  const statusId = useId()
  const showStatus = !hasModel || rejected
  const control = useAtomValue(difyBuilderTaskControlAtom)
  const operation = useAtomValue(difyBuilderTaskControlOperationAtom)
  const canvasReady = useAtomValue(difyBuilderCanvasReadyAtom)
  const controlStatusId = useId()
  const attachmentStatusId = useId()
  const attachmentStatus = files.length
    ? view?.task_status === 'abandoned'
      ? t(($) => $['attachments.abandoned'])
      : view?.run_status === 'paused'
        ? t(($) => $['attachments.paused'])
        : null
    : null
  let controlStatus: string | null = null
  if (control?.phase === 'unknown') {
    controlStatus = t(($) => $['taskControl.unknown'])
  } else if (control?.phase === 'saving') {
    controlStatus = t(($) => $['taskControl.saving'])
  } else if (control) {
    controlStatus =
      control.operation === 'stop'
        ? t(($) => $['taskControl.stopping'])
        : t(($) => $['taskControl.resuming'])
  } else if (operation === 'stop') {
    controlStatus = t(($) => $['taskControl.running'])
  } else if (operation === 'resume') {
    controlStatus = canvasReady
      ? t(($) => $['taskControl.paused'])
      : t(($) => $['taskControl.syncing'])
  }
  const descriptionId =
    [
      showStatus && statusId,
      controlStatus && controlStatusId,
      attachmentStatus && attachmentStatusId,
    ]
      .filter(Boolean)
      .join(' ') || undefined

  if (attachmentsOnly && !canAddMaterial && !files.length) return null

  return (
    <>
      {showStatus && <DifyBuilderModelStatus {...modelState} id={statusId} rejected={rejected} />}
      {controlStatus && (
        <p id={controlStatusId} aria-live="polite" className="sr-only">
          {controlStatus}
        </p>
      )}
      {attachmentStatus && (
        <p
          id={attachmentStatusId}
          role="status"
          className="mx-4 mb-2 system-xs-regular text-text-secondary"
        >
          {attachmentStatus}
        </p>
      )}
      <form
        aria-label={t(($) => $.messagePlaceholder, { ns: 'difyBuilder' })}
        className="mx-4 overflow-hidden rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px] focus-within:border-components-input-border-active-prompt-1"
        onSubmit={(event) => {
          event.preventDefault()
          if (!model || !filesReady) return
          const acceptedFiles = filesStore.getState().files
          if (
            acceptedFiles.length > 5 ||
            acceptedFiles.some(
              (file) =>
                file.progress !== 100 ||
                file.transferMethod !== TransferMethod.local_file ||
                !file.uploadedId,
            )
          )
            return
          const attachments = acceptedFiles.flatMap((file) =>
            file.uploadedId ? [{ upload_file_id: file.uploadedId }] : [],
          )
          void (
            attachments.length
              ? sendDraft(model, { attachments, ...(attachmentsOnly ? { text: '' } : {}) })
              : sendDraft(model)
          ).then((accepted) => {
            if (accepted && filesStore.getState().files === acceptedFiles)
              filesStore.getState().setFiles([])
          })
        }}
      >
        <div className="flex flex-col items-end justify-end p-1.5">
          {!!files.length && (
            <div className="max-h-36 w-full overflow-y-auto p-1">
              <DraftFileList files={files} fileConfig={fileConfig} editable={!material} />
            </div>
          )}
          {!attachmentsOnly && <DifyBuilderPromptInput descriptionId={descriptionId} />}
          <div className="flex h-8 w-full shrink-0 items-center justify-between gap-2 ps-1">
            <div className="flex min-w-0 items-center">
              {!attachmentsOnly && <DifyBuilderModelSelector {...modelState} />}
            </div>
            <div className="flex items-center gap-3">
              <FileUploaderInChatInput
                fileConfig={fileConfig}
                readonly={!canAddMaterial || !runtime?.fileUploadConfig}
              />
              <DifyBuilderComposerAction
                hasModel={hasModel}
                filesReady={filesReady}
                hasFiles={files.length > 0}
                attachmentsOnly={attachmentsOnly}
                descriptionId={descriptionId}
              />
            </div>
          </div>
        </div>
      </form>
    </>
  )
}

const DifyBuilderComposer = (props: { attachmentsOnly?: boolean }) => (
  <DifyBuilderAttachmentScope>
    <DifyBuilderComposerContent {...props} />
  </DifyBuilderAttachmentScope>
)
export default DifyBuilderComposer
