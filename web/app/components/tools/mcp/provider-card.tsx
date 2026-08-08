'use client'
import type { ToolWithProvider } from '../../workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '@/app/components/plugins/card/base/card-icon'
import { useCanManageMCP } from '@/app/components/tools/hooks/use-tool-permissions'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import OperationDropdown from './detail/operation-dropdown'

type Props = Readonly<{
  currentProvider?: ToolWithProvider
  data: ToolWithProvider
  handleSelect: (providerID: string) => void
  onEdit: (providerID: string) => void
  onDelete: (providerID: string) => void
}>

const MCPCard = ({ currentProvider, data, onEdit, onDelete, handleSelect }: Props) => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const canManageMCP = useCanManageMCP()
  const isConfigured = data.is_team_authorization && data.tools.length > 0
  const updatedAtText = data.updated_at
    ? `${t(($) => $['mcp.updateTime'], { ns: 'tools' })} ${formatTimeFromNow(data.updated_at * 1000)}`
    : undefined

  const [isOperationShow, setIsOperationShow] = useState(false)

  const handleSelectProvider = useCallback(() => {
    handleSelect(data.id)
  }, [data.id, handleSelect])

  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs hover:bg-components-panel-on-panel-item-bg-hover',
        currentProvider?.id === data.id &&
          'border-components-option-card-option-selected-border bg-components-panel-on-panel-item-bg-hover',
      )}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={currentProvider?.id === data.id}
        onClick={handleSelectProvider}
        className="flex w-full cursor-pointer flex-col rounded-xl text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset"
      >
        <div className="flex shrink-0 items-center gap-3 rounded-t-xl p-4">
          <div className="shrink-0 overflow-hidden rounded-lg border-[0.5px] border-effects-icon-border">
            <Icon src={data.icon} />
          </div>
          <div className="min-w-0 grow">
            <div className="mb-1 truncate system-md-semibold text-text-secondary" title={data.name}>
              {data.name}
            </div>
            <div
              className="truncate system-xs-regular text-text-tertiary"
              title={data.server_identifier}
            >
              {data.server_identifier}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-b-xl pt-1.5 pr-2.5 pb-2.5 pl-4">
          <div className="flex w-0 grow items-center gap-2">
            {data.tools.length > 0 && (
              <div className="shrink-0 system-xs-regular text-text-tertiary">
                {t(($) => $['mcp.toolsCount'], { ns: 'tools', count: data.tools.length })}
              </div>
            )}
            {!data.tools.length && (
              <div className="shrink-0 system-xs-regular text-text-tertiary">
                {t(($) => $['mcp.noTools'], { ns: 'tools' })}
              </div>
            )}
            {updatedAtText && (
              <>
                <div className="system-xs-regular text-divider-deep">·</div>
                <div
                  className="truncate system-xs-regular text-text-tertiary"
                  title={updatedAtText}
                >
                  {updatedAtText}
                </div>
              </>
            )}
          </div>
          {isConfigured && <StatusDot status="success" size="small" className="shrink-0" />}
          {!isConfigured && (
            <div className="flex shrink-0 items-center gap-1 rounded-md border border-util-colors-red-red-500 bg-components-badge-bg-red-soft px-1.5 py-0.5 system-xs-medium text-util-colors-red-red-500">
              {t(($) => $['mcp.noConfigured'], { ns: 'tools' })}
              <StatusDot status="error" size="small" />
            </div>
          )}
        </div>
      </button>
      {canManageMCP && (
        <div
          className={cn(
            'absolute top-2.5 right-2.5 z-10 hidden group-focus-within:block group-hover:block',
            isOperationShow && 'block',
          )}
        >
          <OperationDropdown
            inCard
            onOpenChange={setIsOperationShow}
            onEdit={() => onEdit(data.id)}
            onRemove={() => onDelete(data.id)}
          />
        </div>
      )}
    </div>
  )
}
export default MCPCard
