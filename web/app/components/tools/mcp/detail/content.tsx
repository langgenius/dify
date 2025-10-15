'use client'
import React, { useCallback, useEffect } from 'react'
import type { FC } from 'react'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import {
  RiCloseLine,
  RiLoader2Line,
  RiLoopLeftLine,
} from '@remixicon/react'
import type { ToolWithProvider } from '../../../workflow/types'
import Icon from '@/app/components/plugins/card/base/card-icon'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import Indicator from '@/app/components/header/indicator'
import Tooltip from '@/app/components/base/tooltip'
import MCPModal from '../modal'
import OperationDropdown from './operation-dropdown'
import ListLoading from './list-loading'
import ToolItem from './tool-item'
import {
  useAuthorizeMCP,
  useDeleteMCP,
  useInvalidateMCPTools,
  useMCPTools,
  useUpdateMCP,
  useUpdateMCPTools,
} from '@/service/use-tools'
import { openOAuthPopup } from '@/hooks/use-oauth'
import cn from '@/utils/classnames'

type Props = {
  detail: ToolWithProvider
  onUpdate: (isDelete?: boolean) => void
  onHide: () => void
  isTriggerAuthorize: boolean
  onFirstCreate: () => void
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
    const res = await authorizeMcp({
      provider_id: detail.id,
    })
    if (res.result === 'success')
      handleUpdateTools()

    else if (res.authorization_url)
      openOAuthPopup(res.authorization_url, handleOAuthCallback)
  }, [onFirstCreate, isCurrentWorkspaceManager, detail, authorizeMcp, handleUpdateTools, handleOAuthCallback])

  const handleUpdate = useCallback(async (data: any) => {
    if (!detail)
      return
    const res = await updateMCP({
      ...data,
      provider_id: detail.id,
    })
    if ((res as any)?.result === 'success') {
      hideUpdateModal()
      onUpdate()
      handleAuthorize()
    }
  }, [detail, updateMCP, hideUpdateModal, onUpdate, handleAuthorize])

  const handleDelete = useCallback(async () => {
    if (!detail)
      return
    showDeleting()
    const res = await deleteMCP(detail.id)
    hideDeleting()
    if ((res as any)?.result === 'success') {
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

  return (
    <>
      <div className={cn('shrink-0 border-b border-divider-subtle bg-components-panel-bg p-4 pb-3')}>
        <div className='flex'>
          <div className='shrink-0 overflow-hidden rounded-xl border border-components-panel-border-subtle'>
            <Icon src={detail.icon} />
          </div>
          <div className='ml-3 w-0 grow'>
            <div className='flex h-5 items-center'>
              <div className='system-md-semibold truncate text-text-primary' title={detail.name}>{detail.name}</div>
            </div>
            <div className='mt-0.5 flex items-center gap-1'>
              <Tooltip popupContent={t('tools.mcp.identifier')}>
                <div className='system-xs-regular shrink-0 cursor-pointer text-text-secondary' onClick={() => copy(detail.server_identifier || '')}>{detail.server_identifier}</div>
              </Tooltip>
              <div className='system-xs-regular shrink-0 text-text-quaternary'>·</div>
              <Tooltip popupContent={t('tools.mcp.modal.serverUrl')}>
                <div className='system-xs-regular truncate text-text-secondary'>{detail.server_url}</div>
              </Tooltip>
            </div>
          </div>
          <div className='flex gap-1'>
            <OperationDropdown
              onEdit={showUpdateModal}
              onRemove={showDeleteConfirm}
            />
            <ActionButton onClick={onHide}>
              <RiCloseLine className='h-4 w-4' />
            </ActionButton>
          </div>
        </div>
        <div className='mt-5'>
          {!isAuthorizing && detail.is_team_authorization && (
            <Button
              variant='secondary'
              className='w-full'
              onClick={handleAuthorize}
              disabled={!isCurrentWorkspaceManager}
            >
              <Indicator className='mr-2' color={'green'} />
              {t('tools.auth.authorized')}
            </Button>
          )}
          {!detail.is_team_authorization && !isAuthorizing && (
            <Button
              variant='primary'
              className='w-full'
              onClick={handleAuthorize}
              disabled={!isCurrentWorkspaceManager}
            >
              {t('tools.mcp.authorize')}
            </Button>
          )}
          {isAuthorizing && (
            <Button
              variant='primary'
              className='w-full'
              disabled
            >
              <RiLoader2Line className={cn('mr-1 h-4 w-4 animate-spin')} />
              {t('tools.mcp.authorizing')}
            </Button>
          )}
        </div>
      </div>
      <div className='flex grow flex-col'>
        {((detail.is_team_authorization && isGettingTools) || isUpdating) && (
          <>
            <div className='flex shrink-0 justify-between gap-2 px-4 pb-1 pt-2'>
              <div className='flex h-6 items-center'>
                {!isUpdating && <div className='system-sm-semibold-uppercase text-text-secondary'>{t('tools.mcp.gettingTools')}</div>}
                {isUpdating && <div className='system-sm-semibold-uppercase text-text-secondary'>{t('tools.mcp.updateTools')}</div>}
              </div>
              <div></div>
            </div>
            <div className='flex h-full w-full grow flex-col overflow-hidden px-4 pb-4'>
              <ListLoading />
            </div>
          </>
        )}
        {!isUpdating && detail.is_team_authorization && !isGettingTools && !toolList.length && (
          <div className='flex h-full w-full flex-col items-center justify-center'>
            <div className='system-sm-regular mb-3 text-text-tertiary'>{t('tools.mcp.toolsEmpty')}</div>
            <Button
              variant='primary'
              onClick={handleUpdateTools}
            >{t('tools.mcp.getTools')}</Button>
          </div>
        )}
        {!isUpdating && !isGettingTools && toolList.length > 0 && (
          <>
            <div className='flex shrink-0 justify-between gap-2 px-4 pb-1 pt-2'>
              <div className='flex h-6 items-center'>
                {toolList.length > 1 && <div className='system-sm-semibold-uppercase text-text-secondary'>{t('tools.mcp.toolsNum', { count: toolList.length })}</div>}
                {toolList.length === 1 && <div className='system-sm-semibold-uppercase text-text-secondary'>{t('tools.mcp.onlyTool')}</div>}
              </div>
              <div>
                <Button size='small' onClick={showUpdateConfirm}>
                  <RiLoopLeftLine className='mr-1 h-3.5 w-3.5' />
                  {t('tools.mcp.update')}
                </Button>
              </div>
            </div>
            <div className='flex h-0 w-full grow flex-col gap-2 overflow-y-auto px-4 pb-4'>
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
          <div className='flex h-full w-full flex-col items-center justify-center'>
            {!isAuthorizing && <div className='system-md-medium mb-1 text-text-secondary'>{t('tools.mcp.authorizingRequired')}</div>}
            {isAuthorizing && <div className='system-md-medium mb-1 text-text-secondary'>{t('tools.mcp.authorizing')}</div>}
            <div className='system-sm-regular text-text-tertiary'>{t('tools.mcp.authorizeTip')}</div>
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
      {isShowDeleteConfirm && (
        <Confirm
          isShow
          title={t('tools.mcp.delete')}
          content={
            <div>
              {t('tools.mcp.deleteConfirmTitle', { mcp: detail.name })}
            </div>
          }
          onCancel={hideDeleteConfirm}
          onConfirm={handleDelete}
          isLoading={deleting}
          isDisabled={deleting}
        />
      )}
      {isShowUpdateConfirm && (
        <Confirm
          isShow
          title={t('tools.mcp.toolUpdateConfirmTitle')}
          content={t('tools.mcp.toolUpdateConfirmContent')}
          onCancel={hideUpdateConfirm}
          onConfirm={handleUpdateTools}
        />
      )}
    </>
  )
}

export default MCPDetailContent
