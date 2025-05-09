import { useCallback } from 'react'
import { useDataSourceOptions } from '../hooks'
import OptionCard from './option-card'
import { File, Watercrawl } from '@/app/components/base/icons/src/public/knowledge'
import { Notion } from '@/app/components/base/icons/src/public/common'
import { Jina } from '@/app/components/base/icons/src/public/llm'
import { DataSourceType } from '@/models/datasets'
import { DataSourceProvider } from '@/models/common'
import type { Datasource } from '../types'

type DataSourceOptionsProps = {
  dataSources: Datasource[]
  dataSourceNodeId: string
  onSelect: (option: string) => void
}

const DATA_SOURCE_ICONS = {
  [DataSourceType.FILE]: File as React.FC<React.SVGProps<SVGSVGElement>>,
  [DataSourceType.NOTION]: Notion as React.FC<React.SVGProps<SVGSVGElement>>,
  [DataSourceProvider.fireCrawl]: '🔥',
  [DataSourceProvider.jinaReader]: Jina as React.FC<React.SVGProps<SVGSVGElement>>,
  [DataSourceProvider.waterCrawl]: Watercrawl as React.FC<React.SVGProps<SVGSVGElement>>,
}

const DataSourceOptions = ({
  dataSources,
  dataSourceNodeId,
  onSelect,
}: DataSourceOptionsProps) => {
  const options = useDataSourceOptions(dataSources)

  const handelSelect = useCallback((value: string) => {
    onSelect(value)
  }, [onSelect])

  return (
    <div className='grid w-full grid-cols-4 gap-1'>
      {options.map(option => (
        <OptionCard
          key={option.value}
          label={option.label}
          selected={dataSourceNodeId === option.value}
          Icon={DATA_SOURCE_ICONS[option.type as keyof typeof DATA_SOURCE_ICONS]}
          onClick={handelSelect.bind(null, option.value)}
        />
      ))}
    </div>
  )
}

export default DataSourceOptions
