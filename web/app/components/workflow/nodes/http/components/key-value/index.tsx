'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { KeyValue } from '../../types'
import KeyValueEdit from './key-value-edit'
import BulkEdit from './bulk-edit'

type Props = {
  readonly: boolean
  list: KeyValue[]
  onChange: (newList: KeyValue[]) => void
  onAdd: () => void
  isKeyValueEdit: boolean
  toggleKeyValueEdit: () => void
}

const KeyValueList: FC<Props> = ({
  readonly,
  list,
  onChange,
  onAdd,
  isKeyValueEdit,
  toggleKeyValueEdit,
}) => {
  const handleBulkValueChange = useCallback((value: string) => {
    const newList = value.split('\n').map((item) => {
      const [key, value] = item.split(':')
      return {
        key: key ? key.trim() : '',
        value: value ? value.trim() : '',
      }
    })
    onChange(newList)
  }, [onChange])

  const bulkList = (() => {
    const res = list.map((item) => {
      if (!item.key && !item.value)
        return ''
      if (!item.value)
        return item.key
      return `${item.key}:${item.value}`
    }).join('\n')
    return res
  })()
  return (
    <>
      {isKeyValueEdit
        ? <KeyValueEdit
          readonly={readonly}
          list={list}
          onChange={onChange}
          onAdd={onAdd}
          onSwitchToBulkEdit={toggleKeyValueEdit}
        />
        : <BulkEdit
          value={bulkList}
          onChange={handleBulkValueChange}
          onSwitchToKeyValueEdit={toggleKeyValueEdit}
        />
      }
    </>
  )
}
export default React.memo(KeyValueList)
