import { useCallback, useEffect } from 'react'
import { useDatasourceOptions } from '../hooks'
import OptionCard from './option-card'
import { File, Watercrawl } from '@/app/components/base/icons/src/public/knowledge'
import { Notion } from '@/app/components/base/icons/src/public/common'
import { Jina } from '@/app/components/base/icons/src/public/llm'
import { DataSourceType } from '@/models/datasets'
import { DataSourceProvider } from '@/models/common'
import type { Datasource } from '../types'

type DataSourceOptionsProps = {
  datasourceNodeId: string
  onSelect: (option: Datasource) => void
}

const DATA_SOURCE_ICONS = {
  [DataSourceType.FILE]: File as React.FC<React.SVGProps<SVGSVGElement>>,
  [DataSourceType.NOTION]: Notion as React.FC<React.SVGProps<SVGSVGElement>>,
  [DataSourceProvider.fireCrawl]: '🔥',
  [DataSourceProvider.jinaReader]: Jina as React.FC<React.SVGProps<SVGSVGElement>>,
  [DataSourceProvider.waterCrawl]: Watercrawl as React.FC<React.SVGProps<SVGSVGElement>>,
}

const DataSourceOptions = ({
  datasourceNodeId,
  onSelect,
}: DataSourceOptionsProps) => {
  const { datasources, options } = useDatasourceOptions()

  const handelSelect = useCallback((value: string) => {
    const selectedOption = datasources.find(option => option.nodeId === value)
    if (!selectedOption)
      return
    onSelect(selectedOption)
  }, [datasources, onSelect])

  useEffect(() => {
    if (options.length > 0)
      handelSelect(options[0].value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className='grid w-full grid-cols-4 gap-1'>
      {options.map(option => (
        <OptionCard
          key={option.value}
          label={option.label}
          selected={datasourceNodeId === option.value}
          Icon={DATA_SOURCE_ICONS[option.type as keyof typeof DATA_SOURCE_ICONS]}
          onClick={handelSelect.bind(null, option.value)}
        />
      ))}
    </div>
  )
}

export default DataSourceOptions
