import type { KeyValue } from '../types'
import { uniqueId } from 'es-toolkit/compat'
import { useCallback, useEffect, useRef, useState } from 'react'

const UNIQUE_ID_PREFIX = 'key-value-'
const strToKeyValueList = (value: string) => {
  return value.split('\n').map((item) => {
    const [key, ...others] = item.split(':')
    return {
      id: uniqueId(UNIQUE_ID_PREFIX),
      key: key!.trim(),
      value: others.join(':').trim(),
    }
  })
}

const normalizeList = (items: KeyValue[]) => {
  return items.map((item) => ({
    ...item,
    id: item.id || uniqueId(UNIQUE_ID_PREFIX),
  }))
}

const stringifyList = (items: KeyValue[], noFilter?: boolean) => {
  const source = noFilter ? items : items.filter((item) => item.key && item.value)
  return source.map((item) => `${item.key}:${item.value}`).join('\n')
}

const useKeyValueList = (value: string, onChange: (value: string) => void, noFilter?: boolean) => {
  const [list, doSetList] = useState<KeyValue[]>(() => (value ? strToKeyValueList(value) : []))
  // Mirror the latest committed list synchronously so callbacks never close over
  // a stale render-time value when several updates fire within one event — e.g.
  // an `onChange` immediately followed by `onAdd` while typing into the trailing row.
  const listRef = useRef(list)
  const commitList = useCallback((next: KeyValue[]) => {
    listRef.current = next
    doSetList(next)
  }, [])
  const setList = useCallback(
    (nextList: KeyValue[]) => {
      const normalized = normalizeList(nextList)
      commitList(normalized)
      if (noFilter) return

      const newValue = stringifyList(normalized, noFilter)
      if (newValue !== value) onChange(newValue)
    },
    [commitList, noFilter, onChange, value],
  )

  useEffect(() => {
    Promise.resolve().then(() => {
      const prev = listRef.current
      const targetItems = value ? strToKeyValueList(value) : []
      const currentValue = stringifyList(prev, noFilter)
      const targetValue = stringifyList(targetItems, noFilter)
      if (currentValue === targetValue) return
      // Preserve ids of rows that already exist (matched positionally) so the
      // Lexical editor is not remounted; only genuinely new rows get a fresh id.
      const reconciled = targetItems.map((item, index) => ({
        ...item,
        id: prev[index]?.id || item.id,
      }))
      commitList(normalizeList(reconciled))
    })
  }, [value, noFilter, commitList])
  const addItem = useCallback(() => {
    setList([
      ...listRef.current,
      {
        id: uniqueId(UNIQUE_ID_PREFIX),
        key: '',
        value: '',
      },
    ])
  }, [setList])

  const [isKeyValueEdit, setIsKeyValueEdit] = useState(true)

  return {
    list: list.length === 0 ? [{ id: uniqueId(UNIQUE_ID_PREFIX), key: '', value: '' }] : list, // no item can not add new item
    setList,
    addItem,
    isKeyValueEdit,
    toggleIsKeyValueEdit: () => setIsKeyValueEdit((isEditing) => !isEditing),
  }
}

export default useKeyValueList
