import { useCallback, useEffect } from 'react'
import { useDatasourceOptions } from '../hooks'
import OptionCard from './option-card'
import type { Datasource } from '../../types'

type DataSourceOptionsProps = {
  dataSourceNodeId: string
  onSelect: (option: Datasource) => void
}

const DataSourceOptions = ({
  dataSourceNodeId,
  onSelect,
}: DataSourceOptionsProps) => {
  const options = useDatasourceOptions()

  const handelSelect = useCallback((value: string) => {
    const selectedOption = options.find(option => option.value === value)
    if (!selectedOption)
      return
    const datasource = {
      nodeId: selectedOption.value,
      nodeData: selectedOption.data,
    }
    onSelect(datasource)
  }, [onSelect, options])

  useEffect(() => {
    if (options.length > 0 && !dataSourceNodeId)
      handelSelect(options[0].value)
  }, [])

  return (
    <div className='grid w-full grid-cols-4 gap-1'>
      {options.map(option => (
        <OptionCard
          key={option.value}
          label={option.label}
          value={option.value}
          nodeData={option.data}
          selected={dataSourceNodeId === option.value}
          onClick={handelSelect}
        />
      ))}
    </div>
  )
}

export default DataSourceOptions
