'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import FileIcon from '../document-file-icon'
import cn from '@/utils/classnames'
import type { DocumentItem } from '@/models/datasets'

type Props = {
  className?: string
  list: DocumentItem[]
  onChange: (value: DocumentItem) => void
}

const DocumentList: FC<Props> = ({
  className,
  list,
  onChange,
}) => {
  const handleChange = useCallback((item: DocumentItem) => {
    return () => onChange(item)
  }, [onChange])

  return (
    <div className={cn(className)}>
      {list.map((item) => {
        const { id, name, extension } = item
        return (
          <div
            key={id}
            className='flex items-center h-8 px-2 hover:bg-state-base-hover rounded-lg space-x-2 cursor-pointer'
            onClick={handleChange(item)}
          >
            <FileIcon name={item.name} extension={extension} size='md' />
            <div className='truncate text-text-secondary text-sm'>{name}</div>
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(DocumentList)
