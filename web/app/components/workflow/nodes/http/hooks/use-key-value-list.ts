import { useCallback, useEffect, useState } from 'react'
import { useBoolean } from 'ahooks'
import { uniqueId } from 'lodash-es'
import type { KeyValue } from '../types'

const UNIQUE_ID_PREFIX = 'key-value-'
const strToKeyValueList = (value: string) => {
  return value.split('\n').map((item) => {
    const [key, ...others] = item.split(':')
    return {
      id: uniqueId(UNIQUE_ID_PREFIX),
      key: key.trim(),
      value: others.join(':').trim(),
    }
  })
}

const useKeyValueList = (value: string, onChange: (value: string) => void, noFilter?: boolean) => {
  const [list, doSetList] = useState<KeyValue[]>(() => value ? strToKeyValueList(value) : [])
  const setList = (l: KeyValue[]) => {
    doSetList(l.map((item) => {
      return {
        ...item,
        id: item.id || uniqueId(UNIQUE_ID_PREFIX),
      }
    }))
  }
  useEffect(() => {
    if (noFilter)
      return
    const newValue = list.filter(item => item.key && item.value).map(item => `${item.key}:${item.value}`).join('\n')
    if (newValue !== value)
      onChange(newValue)
  }, [list, noFilter])
  const addItem = useCallback(() => {
    setList([...list, {
      id: uniqueId(UNIQUE_ID_PREFIX),
      key: '',
      value: '',
    }])
  }, [list])

  const [isKeyValueEdit, {
    toggle: toggleIsKeyValueEdit,
  }] = useBoolean(true)

  return {
    list: list.length === 0 ? [{ id: uniqueId(UNIQUE_ID_PREFIX), key: '', value: '' }] : list, // no item can not add new item
    setList,
    addItem,
    isKeyValueEdit,
    toggleIsKeyValueEdit,
  }
}

export default useKeyValueList
