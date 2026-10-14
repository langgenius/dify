import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { resolveDatasourceIcon } from '@/app/components/rag-pipeline/utils/datasource-icon'
import { matchDataSource } from '@/app/components/workflow/utils/plugin-install-check'
import { consoleQuery } from '@/service/console'
import DatasourceIcon from './datasource-icon'

type OptionCardProps = {
  label: string
  selected: boolean
  nodeData: DataSourceNodeType
  onClick?: () => void
}

const OptionCard = ({ label, selected, nodeData, onClick }: OptionCardProps) => {
  const { data: dataSourceList } = useQuery(
    consoleQuery.rag.pipelines.datasourcePlugins.get.queryOptions(),
  )
  const provider = dataSourceList && matchDataSource(dataSourceList, nodeData)
  const iconUrl = provider && resolveDatasourceIcon(provider.declaration.identity.icon)

  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg p-3 shadow-shadow-shadow-3',
        selected
          ? 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs inset-ring-[0.5px] inset-ring-components-option-card-option-selected-border'
          : 'hover:border-components-option-card-option-border-hover hover:shadow-xs',
      )}
      onClick={onClick}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border bg-background-default-dodge p-1.5">
        <DatasourceIcon iconUrl={iconUrl} />
      </div>
      <div
        className={cn(
          'line-clamp-2 grow system-sm-medium text-text-secondary',
          selected && 'text-text-primary',
        )}
        title={label}
      >
        {label}
      </div>
    </div>
  )
}

export default React.memo(OptionCard)
