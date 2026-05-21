'use client'
import type { ComponentProps } from 'react'
import type { ToolWithProvider } from '../../workflow/types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { useBoolean } from 'ahooks'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Indicator from '@/app/components/header/indicator'
import Icon from '@/app/components/plugins/card/base/card-icon'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useDeleteMCP, useUpdateMCP } from '@/service/use-tools'
import { hasPermission } from '@/utils/permission'
import OperationDropdown from './detail/operation-dropdown'
import MCPModal from './modal'

type Props = {
  currentProvider?: ToolWithProvider
  data: ToolWithProvider
  handleSelect: (providerID: string) => void
  onUpdate: (providerID: string) => void
  onDeleted: () => void
}

type MCPModalConfirmPayload = Parameters<ComponentProps<typeof MCPModal>['onConfirm']>[0]
type MutationResult = {
  result?: string
}

const MCPCard = ({
  currentProvider,
  data,
  onUpdate,
  handleSelect,
  onDeleted,
}: Props) => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const canManageMCP = hasPermission(workspacePermissionKeys, 'mcp.manage')

  const { mutateAsync: updateMCP } = useUpdateMCP({})
  const { mutateAsync: deleteMCP } = useDeleteMCP({})

  const [isOperationShow, setIsOperationShow] = useState(false)

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

  const handleUpdate = useCallback(async (form: MCPModalConfirmPayload) => {
    if (!canManageMCP)
      return

    const res = await updateMCP({
      ...form,
      provider_id: data.id,
    })
    if ((res as MutationResult)?.result === 'success') {
      hideUpdateModal()
      onUpdate(data.id)
    }
  }, [canManageMCP, data, updateMCP, hideUpdateModal, onUpdate])

  const handleDelete = useCallback(async () => {
    if (!canManageMCP)
      return

    showDeleting()
    const res = await deleteMCP(data.id) as MutationResult
    hideDeleting()
    if (res.result === 'success') {
      hideDeleteConfirm()
      onDeleted()
    }
  }, [canManageMCP, showDeleting, deleteMCP, data.id, hideDeleting, hideDeleteConfirm, onDeleted])

  return (
    <div
      onClick={() => handleSelect(data.id)}
      className={cn(
        'group relative flex cursor-pointer flex-col rounded-xl border-[1.5px] border-transparent bg-components-card-bg shadow-xs hover:bg-components-card-bg-alt hover:shadow-md',
        currentProvider?.id === data.id && 'border-components-option-card-option-selected-border bg-components-card-bg-alt',
      )}
    >
      <div className="flex grow items-center gap-3 rounded-t-xl p-4">
        <div className="shrink-0 overflow-hidden rounded-xl border border-components-panel-border-subtle">
          <Icon src={data.icon} />
        </div>
        <div className="grow">
          <div className="mb-1 truncate system-md-semibold text-text-secondary" title={data.name}>{data.name}</div>
          <div className="system-xs-regular text-text-tertiary">{data.server_identifier}</div>
        </div>
      </div>
      <div className="flex items-center gap-1 rounded-b-xl pt-1.5 pr-2.5 pb-2.5 pl-4">
        <div className="flex w-0 grow items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="i-ri-hammer-fill size-3 shrink-0 text-text-quaternary" />
            {data.tools.length > 0 && (
              <div className="shrink-0 system-xs-regular text-text-tertiary">{t('mcp.toolsCount', { ns: 'tools', count: data.tools.length })}</div>
            )}
            {!data.tools.length && (
              <div className="shrink-0 system-xs-regular text-text-tertiary">{t('mcp.noTools', { ns: 'tools' })}</div>
            )}
          </div>
          <div className={cn('system-xs-regular text-divider-deep', (!data.is_team_authorization || !data.tools.length) && 'sm:hidden')}>/</div>
          <div className={cn('truncate system-xs-regular text-text-tertiary', (!data.is_team_authorization || !data.tools.length) && 'sm:hidden')} title={`${t('mcp.updateTime', { ns: 'tools' })} ${formatTimeFromNow(data.updated_at! * 1000)}`}>{`${t('mcp.updateTime', { ns: 'tools' })} ${formatTimeFromNow(data.updated_at! * 1000)}`}</div>
        </div>
        {data.is_team_authorization && data.tools.length > 0 && <Indicator color="green" className="shrink-0" />}
        {(!data.is_team_authorization || !data.tools.length) && (
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-util-colors-red-red-500 bg-components-badge-bg-red-soft px-1.5 py-0.5 system-xs-medium text-util-colors-red-red-500">
            {t('mcp.noConfigured', { ns: 'tools' })}
            <Indicator color="red" />
          </div>
        )}
      </div>
      {canManageMCP && (
        <div className={cn('absolute top-2.5 right-2.5 hidden group-hover:block', isOperationShow && 'block')} onClick={e => e.stopPropagation()}>
          <OperationDropdown
            inCard
            onOpenChange={setIsOperationShow}
            onEdit={showUpdateModal}
            onRemove={showDeleteConfirm}
          />
        </div>
      )}
      {canManageMCP && isShowUpdateModal && (
        <MCPModal
          data={data}
          show={isShowUpdateModal}
          onConfirm={handleUpdate}
          onHide={hideUpdateModal}
        />
      )}
      <AlertDialog open={canManageMCP && isShowDeleteConfirm} onOpenChange={open => !open && hideDeleteConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('mcp.delete', { ns: 'tools' })}
            </AlertDialogTitle>
            <div className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('mcp.deleteConfirmTitle', { ns: 'tools', mcp: data.name })}
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
    </div>
  )
}
export default MCPCard
