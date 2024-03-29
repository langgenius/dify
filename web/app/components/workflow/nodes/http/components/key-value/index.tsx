'use client'
import type { FC } from 'react'
import React from 'react'
import type { KeyValue } from '../../types'
import KeyValueEdit from './key-value-edit'

type Props = {
  readonly: boolean
  nodeId: string
  list: KeyValue[]
  onChange: (newList: KeyValue[]) => void
  onAdd: () => void
  // toggleKeyValueEdit: () => void
}

const KeyValueList: FC<Props> = ({
  readonly,
  nodeId,
  list,
  onChange,
  onAdd,
  // toggleKeyValueEdit,
}) => {
  // const handleBulkValueChange = useCallback((value: string) => {
  //   const newList = value.split('\n').map((item) => {
  //     const [key, value] = item.split(':')
  //     return {
  //       key: key ? key.trim() : '',
  //       value: value ? value.trim() : '',
  //     }
  //   })
  //   onChange(newList)
  // }, [onChange])

  // const bulkList = (() => {
  //   const res = list.map((item) => {
  //     if (!item.key && !item.value)
  //       return ''
  //     if (!item.value)
  //       return item.key
  //     return `${item.key}:${item.value}`
  //   }).join('\n')
  //   return res
  // })()
  return <KeyValueEdit
    readonly={readonly}
    nodeId={nodeId}
    list={list}
    onChange={onChange}
    onAdd={onAdd}
  // onSwitchToBulkEdit={toggleKeyValueEdit}
  />
  // : <BulkEdit
  //   value={bulkList}
  //   onChange={handleBulkValueChange}
  //   onSwitchToKeyValueEdit={toggleKeyValueEdit}
  // />
}
export default React.memo(KeyValueList)
