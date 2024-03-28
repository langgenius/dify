import { useCallback, useEffect, useState } from 'react'
import { useBoolean } from 'ahooks'
import type { KeyValue } from '../types'

const strToKeyValueList = (value: string) => {
  return value.split('\n').map((item) => {
    const [key, value] = item.split(':')
    return { key: key.trim(), value: value?.trim() }
  })
}

const useKeyValueList = (value: string, onChange: (value: string) => void, noFilter?: boolean) => {
  const [list, setList] = useState<KeyValue[]>(value ? strToKeyValueList(value) : [])
  useEffect(() => {
    if (noFilter)
      return
    const newValue = list.filter(item => item.key && item.value).map(item => `${item.key}:${item.value}`).join('\n')
    if (newValue !== value)
      onChange(newValue)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, noFilter])
  const addItem = useCallback(() => {
    setList(prev => [...prev, { key: '', value: '' }])
  }, [])

  const [isKeyValueEdit, {
    toggle: toggleIsKeyValueEdit,
  }] = useBoolean(true)

  return {
    list: list.length === 0 ? [{ key: '', value: '' }] : list, // no item can not add new item
    setList,
    addItem,
    isKeyValueEdit,
    toggleIsKeyValueEdit,
  }
}

export default useKeyValueList
