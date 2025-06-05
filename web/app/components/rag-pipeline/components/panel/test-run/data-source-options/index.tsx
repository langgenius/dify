import { useCallback, useEffect } from 'react'
import { useDatasourceOptions } from '../hooks'
import OptionCard from './option-card'
import type { Datasource } from '../types'

type DataSourceOptionsProps = {
  dataSourceNodeId: string
  onSelect: (option: Datasource) => void
}

const DataSourceOptions = ({
  dataSourceNodeId,
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
          nodeData={option.data}
          selected={dataSourceNodeId === option.value}
          onClick={handelSelect.bind(null, option.value)}
        />
      ))}
    </div>
  )
}

export default DataSourceOptions
