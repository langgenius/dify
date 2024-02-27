'use client'
import type { FC } from 'react'
import React from 'react'
import type { KeyValue } from '../types'
import KeyValueItem from './key-value-item'

type Props = {
  list: KeyValue[]
  onChange: (newList: KeyValue[]) => void
  onAdd: () => void
}

const KeyValueList: FC<Props> = ({
  list,
  onChange,
  onAdd,
}) => {
  return (
    <div>
      <div>
        <div>key</div>
        <div>value</div>
      </div>
      {
        list.map((item, index) => (
          <KeyValueItem
            key={index}
            payload={item}
            onChange={(newItem) => {
              const newList = [...list]
              newList[index] = newItem
              onChange(newList)
            }}
            onRemove={() => {
              const newList = [...list]
              newList.splice(index, 1)
              onChange(newList)
            }}
            isLastItem={index === list.length - 1}
            onAdd={onAdd}
          />
        ))
      }
    </div>
  )
}
export default React.memo(KeyValueList)
