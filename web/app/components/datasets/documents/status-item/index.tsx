import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import type { DocumentIndexingRetryAction } from '../hooks/use-document-retry-actions'
import type { OperationName } from '../types'
import type { DocumentDisplayStatus } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { asyncRunSafe } from '@/utils'
import { useDocumentRetryActions } from '../hooks/use-document-retry-actions'
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
  retryAction?: DocumentIndexingRetryAction | null
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
const StatusItem = ({
  status,
  retryAction,
  reverse = false,
  scene = 'list',
  textCls = '',
  errorMessage,
  datasetId = '',
  detail,
  onUpdate,
  canEdit = false,
}: StatusItemProps) => {
  const statusLabelId = React.useId()

  const { t } = useTranslation(['common', 'dataset', 'datasetDocuments'])
  const DOC_INDEX_STATUS_MAP = useIndexStatus()
  const localStatus = status.toLowerCase() as keyof typeof DOC_INDEX_STATUS_MAP
  const statusItem = DOC_INDEX_STATUS_MAP[localStatus]
  const { enabled = false, archived = false, id = '' } = detail || {}
  const documents = consoleQuery.datasets.byDatasetId.documents
  const { mutateAsync: changeDocumentStatus } = useMutation(
    documents.status.byAction.batch.patch.mutationOptions(),
  )
  const { mutateAsync: deleteDocuments } = useMutation(documents.delete.mutationOptions())
  const { retryDocuments, isPending: isRetrying } = useDocumentRetryActions(datasetId)
  const onOperate = async (operationName: OperationName) => {
    if (!canEdit) return

    const [e] = await asyncRunSafe(
      operationName === 'enable' || operationName === 'disable'
        ? changeDocumentStatus({
            params: { dataset_id: datasetId, action: operationName },
            query: { document_id: [id] },
          })
        : deleteDocuments({ params: { dataset_id: datasetId }, query: { document_id: [id] } }),
    )
    if (!e) {
      onUpdate?.(operationName)
    } else {
      toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    }
  }
  const { run: handleSwitch } = useDebounceFn(
    (operationName: OperationName) => {
      if (!canEdit) return
      if (operationName === 'enable' && enabled) return
      if (operationName === 'disable' && !enabled) return
      onOperate(operationName)
    },
    { wait: 500 },
  )
  const embedding = useMemo(() => {
    return ['queuing', 'indexing', 'paused'].includes(localStatus)
  }, [localStatus])
  const handleRetry = async () => {
    if (!canEdit || !retryAction || !id) return

    const [e] = await asyncRunSafe(retryDocuments([{ id, action: retryAction }]))
    if (!e) {
      onUpdate?.(retryAction)
    } else {
      toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    }
  }
  return (
    <div
      className={cn(
        'flex items-center',
        reverse ? 'flex-row-reverse' : '',
        scene === 'detail' ? s.statusItemDetail : '',
      )}
    >
      <StatusDot status={statusItem.status} className={reverse ? 'ml-2' : 'mr-2'} />
      <span
        id={statusLabelId}
        className={cn(`${STATUS_TEXT_COLOR_MAP[statusItem.status]} text-sm`, textCls)}
      >
        {statusItem.text}
      </span>
      {errorMessage && (
        <Infotip>
          <InfotipTrigger aria-labelledby={statusLabelId} className="ml-1" />
          <InfotipContent aria-labelledby={statusLabelId} className="max-w-65">
            {errorMessage}
          </InfotipContent>
        </Infotip>
      )}
      {retryAction && canEdit && (
        <Button
          variant="ghost-accent"
          size="small"
          className="ml-1.5"
          loading={isRetrying}
          onClick={handleRetry}
        >
          {t(($) => $.retry, { ns: 'dataset' })}
        </Button>
      )}
      {scene === 'detail' && (
        <div className="ml-1.5 flex items-center justify-between">
          <Tooltip disabled={!archived}>
            <TooltipTrigger
              render={
                <span className="flex">
                  <Switch
                    aria-labelledby={statusLabelId}
                    checked={archived ? false : enabled}
                    onCheckedChange={(v) =>
                      !archived && canEdit && handleSwitch(v ? 'enable' : 'disable')
                    }
                    disabled={embedding || archived || !canEdit}
                    size="md"
                  />
                </span>
              }
            />
            <TooltipContent>
              {t(($) => $['list.action.enableWarning'], { ns: 'datasetDocuments' })}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}
export default React.memo(StatusItem)
