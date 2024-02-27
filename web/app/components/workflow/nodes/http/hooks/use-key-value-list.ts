import { useCallback, useState } from 'react'
import type { KeyValue } from '../types'

const strToKeyValueList = (value: string) => {
  return value.split('\n').map((item) => {
    const [key, value] = item.split(':')
    return { key: key.trim(), value: value.trim() }
  })
}

const useKeyValueList = (value: string) => {
  const [list, setList] = useState<KeyValue[]>(value ? strToKeyValueList(value) : [])
  const addItem = useCallback(() => {
    setList(prev => [...prev, { key: '', value: '' }])
  }, [])
  return {
    list,
    setList,
    addItem,
  }
}

export default useKeyValueList
