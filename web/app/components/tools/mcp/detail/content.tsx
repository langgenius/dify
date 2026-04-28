'use client'
import type { ComponentProps, FC } from 'react'
import type { ToolWithProvider } from '../../../workflow/types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Indicator from '@/app/components/header/indicator'
import Icon from '@/app/components/plugins/card/base/card-icon'
import { useAppContext } from '@/context/app-context'
import { openOAuthPopup } from '@/hooks/use-oauth'
import {
  useAuthorizeMCP,
  useDeleteMCP,
  useInvalidateMCPTools,
  useMCPTools,
  useUpdateMCP,
  useUpdateMCPTools,
} from '@/service/use-tools'
import MCPModal from '../modal'
import ListLoading from './list-loading'
import OperationDropdown from './operation-dropdown'
import ToolItem from './tool-item'

type Props = {
  detail: ToolWithProvider
  onUpdate: (isDelete?: boolean) => void
  onHide: () => void
  isTriggerAuthorize: boolean
  onFirstCreate: () => void
}

type MCPModalConfirmPayload = Parameters<ComponentProps<typeof MCPModal>['onConfirm']>[0]
type MutationResult = {
  result?: string
}

const MCPDetailContent: FC<Props> = ({
  detail,
  onUpdate,
  onHide,
  isTriggerAuthorize,
  onFirstCreate,
}) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()

  const { data, isFetching: isGettingTools } = useMCPTools(detail.is_team_authorization ? detail.id : '')
  const invalidateMCPTools = useInvalidateMCPTools()
  const { mutateAsync: updateTools, isPending: isUpdating } = useUpdateMCPTools()
  const { mutateAsync: authorizeMcp, isPending: isAuthorizing } = useAuthorizeMCP()
  const toolList = data?.tools || []

  const [isShowUpdateConfirm, {
    setTrue: showUpdateConfirm,
    setFalse: hideUpdateConfirm,
  }] = useBoolean(false)

  const handleUpdateTools = useCallback(async () => {
    hideUpdateConfirm()
    if (!detail)
      return
    await updateTools(detail.id)
    invalidateMCPTools(detail.id)
    onUpdate()
  }, [detail, hideUpdateConfirm, invalidateMCPTools, onUpdate, updateTools])

  const { mutateAsync: updateMCP } = useUpdateMCP({})
  const { mutateAsync: deleteMCP } = useDeleteMCP({})

  const [isShowUpdateModal, {
    setTrue: showUpdateModal,
    setFalse: hideUpdateModal,
  }] = useBoolean(false)

  const [isShowDeleteConfirm, {
    setTrue: showDeleteConfirm,
    setFalse: hideDeleteConfirm,
  }] = useBoolean(false)

  const [deleting, {
    setTrue: showDeleting,
    setFalse: hideDeleting,
  }] = useBoolean(false)

  const handleOAuthCallback = useCallback(() => {
    if (!isCurrentWorkspaceManager)
      return
    if (!detail.id)
      return
    handleUpdateTools()
  }, [detail.id, handleUpdateTools, isCurrentWorkspaceManager])

  const handleAuthorize = useCallback(async () => {
    onFirstCreate()
    if (!isCurrentWorkspaceManager)
      return
    if (!detail)
      return
    try {
      const res = await authorizeMcp({
        provider_id: detail.id,
      })
      if (res.result === 'success')
        handleUpdateTools()

      else if (res.authorization_url)
        openOAuthPopup(res.authorization_url, handleOAuthCallback)
    }
    catch {
      // On authorization error, refresh the parent component state
      // to update the connection status indicator
      onUpdate()
    }
  }, [onFirstCreate, isCurrentWorkspaceManager, detail, authorizeMcp, handleUpdateTools, handleOAuthCallback, onUpdate])

  const handleUpdate = useCallback(async (data: MCPModalConfirmPayload) => {
    if (!detail)
      return
    const res = await updateMCP({
      ...data,
      provider_id: detail.id,
    }) as MutationResult
    if (res.result === 'success') {
      hideUpdateModal()
      onUpdate()
      handleAuthorize()
    }
  }, [detail, updateMCP, hideUpdateModal, onUpdate, handleAuthorize])

  const handleDelete = useCallback(async () => {
    if (!detail)
      return
    showDeleting()
    const res = await deleteMCP(detail.id) as MutationResult
    hideDeleting()
    if (res.result === 'success') {
      hideDeleteConfirm()
      onUpdate(true)
    }
  }, [detail, showDeleting, deleteMCP, hideDeleting, hideDeleteConfirm, onUpdate])

  useEffect(() => {
    if (isTriggerAuthorize)
      handleAuthorize()
  }, [])

  if (!detail)
    return null
  const identifierLabel = t('mcp.identifier', { ns: 'tools' })
  const serverUrlLabel = t('mcp.modal.serverUrl', { ns: 'tools' })

  return (
    <>
      <div className={cn('shrink-0 border-b border-divider-subtle bg-components-panel-bg p-4 pb-3')}>
        <div className="flex">
          <div className="shrink-0 overflow-hidden rounded-xl border border-components-panel-border-subtle">
            <Icon src={detail.icon} />
          </div>
          <div className="ml-3 w-0 grow">
            <div className="flex h-5 items-center">
              <div className="truncate system-md-semibold text-text-primary" title={detail.name}>{detail.name}</div>
            </div>
            <div className="mt-0.5 flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <Button
                      type="button"
                      variant="ghost"
                      size="small"
                      aria-label={identifierLabel}
                      className="h-auto shrink-0 cursor-pointer rounded bg-transparent p-0 text-left system-xs-regular text-text-secondary hover:bg-transparent focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                      onClick={() => copy(detail.server_identifier || '')}
                    >
                      {detail.server_identifier}
                    </Button>
                  )}
                />
                <TooltipContent>
                  {identifierLabel}
                </TooltipContent>
              </Tooltip>
              <div className="shrink-0 system-xs-regular text-text-quaternary">·</div>
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <div aria-label={serverUrlLabel} className="truncate system-xs-regular text-text-secondary">
                      {detail.server_url}
                    </div>
                  )}
                />
                <TooltipContent>
                  {serverUrlLabel}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="flex gap-1">
            <OperationDropdown
              onEdit={showUpdateModal}
              onRemove={showDeleteConfirm}
            />
            <ActionButton aria-label={t('operation.close', { ns: 'common' })} onClick={onHide}>
              <span aria-hidden className="i-ri-close-line h-4 w-4" />
            </ActionButton>
          </div>
        </div>
        <div className="mt-5">
          {!isAuthorizing && detail.is_team_authorization && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleAuthorize}
              disabled={!isCurrentWorkspaceManager}
            >
              <Indicator className="mr-2" color="green" />
              {t('auth.authorized', { ns: 'tools' })}
            </Button>
          )}
          {!detail.is_team_authorization && !isAuthorizing && (
            <Button
              variant="primary"
              className="w-full"
              onClick={handleAuthorize}
              disabled={!isCurrentWorkspaceManager}
            >
              {t('mcp.authorize', { ns: 'tools' })}
            </Button>
          )}
          {isAuthorizing && (
            <Button
              variant="primary"
              className="w-full"
              disabled
            >
              <span aria-hidden className="mr-1 i-ri-loader-2-line h-4 w-4 animate-spin" />
              {t('mcp.authorizing', { ns: 'tools' })}
            </Button>
          )}
        </div>
      </div>
      <div className="flex grow flex-col">
        {((detail.is_team_authorization && isGettingTools) || isUpdating) && (
          <>
            <div className="flex shrink-0 justify-between gap-2 px-4 pt-2 pb-1">
              <div className="flex h-6 items-center">
                {!isUpdating && <div className="system-sm-semibold-uppercase text-text-secondary">{t('mcp.gettingTools', { ns: 'tools' })}</div>}
                {isUpdating && <div className="system-sm-semibold-uppercase text-text-secondary">{t('mcp.updateTools', { ns: 'tools' })}</div>}
              </div>
              <div></div>
            </div>
            <div className="flex h-full w-full grow flex-col overflow-hidden px-4 pb-4">
              <ListLoading />
            </div>
          </>
        )}
        {!isUpdating && detail.is_team_authorization && !isGettingTools && !toolList.length && (
          <div className="flex h-full w-full flex-col items-center justify-center">
            <div className="mb-3 system-sm-regular text-text-tertiary">{t('mcp.toolsEmpty', { ns: 'tools' })}</div>
            <Button
              variant="primary"
              onClick={handleUpdateTools}
            >
              {t('mcp.getTools', { ns: 'tools' })}
            </Button>
          </div>
        )}
        {!isUpdating && !isGettingTools && toolList.length > 0 && (
          <>
            <div className="flex shrink-0 justify-between gap-2 px-4 pt-2 pb-1">
              <div className="flex h-6 items-center">
                {toolList.length > 1 && <div className="system-sm-semibold-uppercase text-text-secondary">{t('mcp.toolsNum', { ns: 'tools', count: toolList.length })}</div>}
                {toolList.length === 1 && <div className="system-sm-semibold-uppercase text-text-secondary">{t('mcp.onlyTool', { ns: 'tools' })}</div>}
              </div>
              <div>
                <Button size="small" onClick={showUpdateConfirm}>
                  <span aria-hidden className="mr-1 i-ri-loop-left-line h-3.5 w-3.5" />
                  {t('mcp.update', { ns: 'tools' })}
                </Button>
              </div>
            </div>
            <div className="flex h-0 w-full grow flex-col gap-2 overflow-y-auto px-4 pb-4">
              {toolList.map(tool => (
                <ToolItem
                  key={`${detail.id}${tool.name}`}
                  tool={tool}
                />
              ))}
            </div>
          </>
        )}

        {!isUpdating && !detail.is_team_authorization && (
          <div className="flex h-full w-full flex-col items-center justify-center">
            {!isAuthorizing && <div className="mb-1 system-md-medium text-text-secondary">{t('mcp.authorizingRequired', { ns: 'tools' })}</div>}
            {isAuthorizing && <div className="mb-1 system-md-medium text-text-secondary">{t('mcp.authorizing', { ns: 'tools' })}</div>}
            <div className="system-sm-regular text-text-tertiary">{t('mcp.authorizeTip', { ns: 'tools' })}</div>
          </div>
        )}
      </div>
      {isShowUpdateModal && (
        <MCPModal
          data={detail}
          show={isShowUpdateModal}
          onConfirm={handleUpdate}
          onHide={hideUpdateModal}
        />
      )}
      <AlertDialog open={isShowDeleteConfirm} onOpenChange={open => !open && hideDeleteConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('mcp.delete', { ns: 'tools' })}
            </AlertDialogTitle>
            <div className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('mcp.deleteConfirmTitle', { ns: 'tools', mcp: detail.name })}
            </div>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={deleting} disabled={deleting} onClick={handleDelete}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={isShowUpdateConfirm} onOpenChange={open => !open && hideUpdateConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('mcp.toolUpdateConfirmTitle', { ns: 'tools' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('mcp.toolUpdateConfirmContent', { ns: 'tools' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={handleUpdateTools}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default MCPDetailContent
