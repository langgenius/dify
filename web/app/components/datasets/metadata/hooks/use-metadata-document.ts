import { useState } from 'react'
import type { MetadataItemWithValue } from '../types'
import { DataType } from '../types'

const testDocMetadataList: MetadataItemWithValue[] = [
  { id: 'str-same-value', name: 'name', type: DataType.string, value: 'Joel' },
  { id: 'num', name: 'age', type: DataType.number, value: 10 },
  { id: 'date', name: 'date', type: DataType.time, value: null },
  { id: 'str-with-different-value', name: 'hobby', type: DataType.string, value: 'bbb' },
]

const useMetadataDocument = () => {
  const [list, setList] = useState<MetadataItemWithValue[]>(testDocMetadataList)
  const [tempList, setTempList] = useState<MetadataItemWithValue[]>(list)
  const builtInEnabled = true
}

export default useMetadataDocument
