import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import type { OperationName } from '../types'
import type { CommonResponse } from '@/models/common'
import type { DocumentDisplayStatus } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useDebounceFn } from 'ahooks'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from '#i18n'
import { Infotip } from '@/app/components/base/infotip'
import { useDocumentDelete, useDocumentDisable, useDocumentEnable } from '@/service/knowledge/use-document'
import { asyncRunSafe } from '@/utils'
import s from '../style.module.css'
import { useIndexStatus } from './hooks'

const STATUS_TEXT_COLOR_MAP: Record<StatusDotStatus, string> = {
  success: 'text-util-colors-green-green-600',
  warning: 'text-util-colors-warning-warning-600',
  error: 'text-util-colors-red-red-600',
  normal: 'text-util-colors-blue-light-blue-light-600',
  disabled: 'text-text-tertiary',
}
type StatusItemProps = {
  status: DocumentDisplayStatus
  reverse?: boolean
  scene?: 'list' | 'detail'
  textCls?: string
  errorMessage?: string
  detail?: {
    enabled: boolean
    archived: boolean
    id: string
  }
  datasetId?: string
  onUpdate?: (operationName?: string) => void
  canEdit?: boolean
}
const StatusItem = ({ status, reverse = false, scene = 'list', textCls = '', errorMessage, datasetId = '', detail, onUpdate, canEdit = false }: StatusItemProps) => {
  const { t } = useTranslation()
  const DOC_INDEX_STATUS_MAP = useIndexStatus()
  const localStatus = status.toLowerCase() as keyof typeof DOC_INDEX_STATUS_MAP
  const statusItem = DOC_INDEX_STATUS_MAP[localStatus]
  const { enabled = false, archived = false, id = '' } = detail || {}
  const { mutateAsync: enableDocument } = useDocumentEnable()
  const { mutateAsync: disableDocument } = useDocumentDisable()
  const { mutateAsync: deleteDocument } = useDocumentDelete()
  const onOperate = async (operationName: OperationName) => {
    if (!canEdit)
      return

    let opApi = deleteDocument
    switch (operationName) {
      case 'enable':
        opApi = enableDocument
        break
      case 'disable':
        opApi = disableDocument
        break
    }
    const [e] = await asyncRunSafe<CommonResponse>(opApi({ datasetId, documentId: id }) as Promise<CommonResponse>)
    if (!e) {
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      onUpdate?.(operationName)
    }
    else {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
    }
  }
  const { run: handleSwitch } = useDebounceFn((operationName: OperationName) => {
    if (!canEdit)
      return
    if (operationName === 'enable' && enabled)
      return
    if (operationName === 'disable' && !enabled)
      return
    onOperate(operationName)
  }, { wait: 500 })
  const embedding = useMemo(() => {
    return ['queuing', 'indexing', 'paused'].includes(localStatus)
  }, [localStatus])
  return (
    <div className={cn('flex items-center', reverse ? 'flex-row-reverse' : '', scene === 'detail' ? s.statusItemDetail : '')}>
      <StatusDot status={statusItem.status} className={reverse ? 'ml-2' : 'mr-2'} />
      <span className={cn(`${STATUS_TEXT_COLOR_MAP[statusItem.status]} text-sm`, textCls)}>
        {statusItem.text}
      </span>
      {errorMessage && (
        <Infotip
          aria-label={errorMessage}
          className="ml-1"
          popupClassName="max-w-[260px] break-all"
        >
          {errorMessage}
        </Infotip>
      )}
      {scene === 'detail' && (
        <div className="ml-1.5 flex items-center justify-between">
          <Tooltip disabled={!archived}>
            <TooltipTrigger
              render={(
                <span className="flex">
                  <Switch
                    checked={archived ? false : enabled}
                    onCheckedChange={v => !archived && canEdit && handleSwitch(v ? 'enable' : 'disable')}
                    disabled={embedding || archived || !canEdit}
                    size="md"
                  />
                </span>
              )}
            />
            <TooltipContent className="system-xs-medium text-text-secondary">
              {t('list.action.enableWarning', { ns: 'datasetDocuments' })}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}
export default React.memo(StatusItem)
