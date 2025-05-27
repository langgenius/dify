import { useCallback, useEffect } from 'react'
import { useDatasourceOptions } from '../hooks'
import OptionCard from './option-card'
import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { Node } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'

type DataSourceOptionsProps = {
  pipelineNodes: Node<DataSourceNodeType>[]
  datasourceNodeId: string
  onSelect: (option: Datasource) => void
}

const DataSourceOptions = ({
  pipelineNodes,
  datasourceNodeId,
  onSelect,
}: DataSourceOptionsProps) => {
  const { datasources, options } = useDatasourceOptions(pipelineNodes)

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
          nodeData={option.data}
          onClick={handelSelect.bind(null, option.value)}
        />
      ))}
    </div>
  )
}

export default DataSourceOptions
