'use client'
import type { ToolWithProvider } from '../../workflow/types'
import { RiHammerFill } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import Indicator from '@/app/components/header/indicator'
import Icon from '@/app/components/plugins/card/base/card-icon'
import { useAppContext } from '@/context/app-context'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useDeleteMCP, useUpdateMCP } from '@/service/use-tools'
import { cn } from '@/utils/classnames'
import OperationDropdown from './detail/operation-dropdown'
import MCPModal from './modal'

type Props = {
  currentProvider?: ToolWithProvider
  data: ToolWithProvider
  handleSelect: (providerID: string) => void
  onUpdate: (providerID: string) => void
  onDeleted: () => void
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
  const { isCurrentWorkspaceManager } = useAppContext()

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

  const handleUpdate = useCallback(async (form: any) => {
    const res = await updateMCP({
      ...form,
      provider_id: data.id,
    })
    if ((res as any)?.result === 'success') {
      hideUpdateModal()
      onUpdate(data.id)
    }
  }, [data, updateMCP, hideUpdateModal, onUpdate])

  const handleDelete = useCallback(async () => {
    showDeleting()
    const res = await deleteMCP(data.id)
    hideDeleting()
    if ((res as any)?.result === 'success') {
      hideDeleteConfirm()
      onDeleted()
    }
  }, [showDeleting, deleteMCP, data.id, hideDeleting, hideDeleteConfirm, onDeleted])

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
          <div className="system-md-semibold mb-1 truncate text-text-secondary" title={data.name}>{data.name}</div>
          <div className="system-xs-regular text-text-tertiary">{data.server_identifier}</div>
        </div>
      </div>
      <div className="flex items-center gap-1 rounded-b-xl pb-2.5 pl-4 pr-2.5 pt-1.5">
        <div className="flex w-0 grow items-center gap-2">
          <div className="flex items-center gap-1">
            <RiHammerFill className="h-3 w-3 shrink-0 text-text-quaternary" />
            {data.tools.length > 0 && (
              <div className="system-xs-regular shrink-0 text-text-tertiary">{t('mcp.toolsCount', { ns: 'tools', count: data.tools.length })}</div>
            )}
            {!data.tools.length && (
              <div className="system-xs-regular shrink-0 text-text-tertiary">{t('mcp.noTools', { ns: 'tools' })}</div>
            )}
          </div>
          <div className={cn('system-xs-regular text-divider-deep', (!data.is_team_authorization || !data.tools.length) && 'sm:hidden')}>/</div>
          <div className={cn('system-xs-regular truncate text-text-tertiary', (!data.is_team_authorization || !data.tools.length) && ' sm:hidden')} title={`${t('mcp.updateTime', { ns: 'tools' })} ${formatTimeFromNow(data.updated_at! * 1000)}`}>{`${t('mcp.updateTime', { ns: 'tools' })} ${formatTimeFromNow(data.updated_at! * 1000)}`}</div>
        </div>
        {data.is_team_authorization && data.tools.length > 0 && <Indicator color="green" className="shrink-0" />}
        {(!data.is_team_authorization || !data.tools.length) && (
          <div className="system-xs-medium flex shrink-0 items-center gap-1 rounded-md border border-util-colors-red-red-500 bg-components-badge-bg-red-soft px-1.5 py-0.5 text-util-colors-red-red-500">
            {t('mcp.noConfigured', { ns: 'tools' })}
            <Indicator color="red" />
          </div>
        )}
      </div>
      {isCurrentWorkspaceManager && (
        <div className={cn('absolute right-2.5 top-2.5 hidden group-hover:block', isOperationShow && 'block')} onClick={e => e.stopPropagation()}>
          <OperationDropdown
            inCard
            onOpenChange={setIsOperationShow}
            onEdit={showUpdateModal}
            onRemove={showDeleteConfirm}
          />
        </div>
      )}
      {isShowUpdateModal && (
        <MCPModal
          data={data}
          show={isShowUpdateModal}
          onConfirm={handleUpdate}
          onHide={hideUpdateModal}
        />
      )}
      {isShowDeleteConfirm && (
        <Confirm
          isShow
          title={t('mcp.delete', { ns: 'tools' })}
          content={(
            <div>
              {t('mcp.deleteConfirmTitle', { ns: 'tools', mcp: data.name })}
            </div>
          )}
          onCancel={hideDeleteConfirm}
          onConfirm={handleDelete}
          isLoading={deleting}
          isDisabled={deleting}
        />
      )}
    </div>
  )
}
export default MCPCard
