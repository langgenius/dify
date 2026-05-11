import type { OperationName } from '../types'
import type { ColorMap, IndicatorProps } from '@/app/components/header/indicator'
import type { CommonResponse } from '@/models/common'
import type { DocumentDisplayStatus } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useDebounceFn } from 'ahooks'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import Indicator from '@/app/components/header/indicator'
import { useDocumentDelete, useDocumentDisable, useDocumentEnable } from '@/service/knowledge/use-document'
import { asyncRunSafe } from '@/utils'
import s from '../style.module.css'
import { useIndexStatus } from './hooks'

const STATUS_TEXT_COLOR_MAP: ColorMap = {
  green: 'text-util-colors-green-green-600',
  orange: 'text-util-colors-warning-warning-600',
  red: 'text-util-colors-red-red-600',
  blue: 'text-util-colors-blue-light-blue-light-600',
  yellow: 'text-util-colors-warning-warning-600',
  gray: 'text-text-tertiary',
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
}
const StatusItem = ({ status, reverse = false, scene = 'list', textCls = '', errorMessage, datasetId = '', detail, onUpdate }: StatusItemProps) => {
  const { t } = useTranslation()
  const DOC_INDEX_STATUS_MAP = useIndexStatus()
  const localStatus = status.toLowerCase() as keyof typeof DOC_INDEX_STATUS_MAP
  const { enabled = false, archived = false, id = '' } = detail || {}
  const { mutateAsync: enableDocument } = useDocumentEnable()
  const { mutateAsync: disableDocument } = useDocumentDisable()
  const { mutateAsync: deleteDocument } = useDocumentDelete()
  const onOperate = async (operationName: OperationName) => {
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
      <Indicator color={DOC_INDEX_STATUS_MAP[localStatus]?.color as IndicatorProps['color']} className={reverse ? 'ml-2' : 'mr-2'} />
      <span className={cn(`${STATUS_TEXT_COLOR_MAP[DOC_INDEX_STATUS_MAP[localStatus].color as keyof typeof STATUS_TEXT_COLOR_MAP]} text-sm`, textCls)}>
        {DOC_INDEX_STATUS_MAP[localStatus]?.text}
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
                    onCheckedChange={v => !archived && handleSwitch(v ? 'enable' : 'disable')}
                    disabled={embedding || archived}
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
