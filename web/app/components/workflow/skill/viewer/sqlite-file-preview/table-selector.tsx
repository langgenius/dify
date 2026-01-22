import type { FC } from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import { TableCells } from '@/app/components/base/icons/src/vender/solid/development'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'

type TableSelectorProps = {
  tables: string[]
  selectedTable: string
  isLoading?: boolean
  onTableChange: (tableName: string) => void
}

const TableSelector: FC<TableSelectorProps> = ({
  tables,
  selectedTable,
  isLoading = false,
  onTableChange,
}) => {
  const { t } = useTranslation('workflow')
  const [open, setOpen] = useState(false)
  const items = useMemo(() => {
    return tables.map(name => ({
      value: name,
      name,
    }))
  }, [tables])

  const label = selectedTable || t('skillSidebar.sqlitePreview.selectTable')
  const isPlaceholder = !selectedTable
  const isSingleTable = tables.length === 1

  if (isSingleTable) {
    return (
      <div className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-text-secondary">
        <TableCells className="h-3.5 w-3.5 text-text-secondary" aria-hidden="true" />
        <span className={cn('system-sm-medium min-w-0 max-w-[220px] truncate', isPlaceholder && 'text-text-tertiary')}>
          {label}
        </span>
      </div>
    )
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={4}
    >
      <div className="relative">
        <PortalToFollowElemTrigger asChild>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => {
              if (!isLoading)
                setOpen(prev => !prev)
            }}
            className={cn(
              'inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-text-secondary',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
              isLoading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-state-base-hover',
            )}
          >
            <TableCells className="h-3.5 w-3.5 text-text-secondary" aria-hidden="true" />
            <span className={cn('system-sm-medium min-w-0 max-w-[220px] truncate', isPlaceholder && 'text-text-tertiary')}>
              {label}
            </span>
            <RiArrowDownSLine className="h-3.5 w-3.5 text-text-secondary" aria-hidden="true" />
          </button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-20">
          <div className="min-w-[220px] rounded-lg border border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-sm">
            {items.map(item => (
              <button
                key={item.value}
                type="button"
                className={cn(
                  'system-sm-medium flex w-full items-center gap-1 rounded-lg px-2 py-1 text-left text-text-secondary hover:bg-state-base-hover',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
                  item.value === selectedTable && 'bg-state-base-hover',
                )}
                onClick={() => {
                  onTableChange(String(item.value))
                  setOpen(false)
                }}
              >
                <TableCells className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
                <span className="flex-1 truncate px-1">{item.name}</span>
                {item.value === selectedTable && (
                  <Check className="h-4 w-4 shrink-0 text-text-accent" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default React.memo(TableSelector)
