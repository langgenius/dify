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
    <div className={cn('max-h-[calc(100vh-120px)] overflow-auto', className)}>
      {list.map((item) => {
        const { id, name, extension } = item
        return (
          <div
            key={id}
            className='flex h-8 cursor-pointer items-center space-x-2 rounded-lg px-2 hover:bg-state-base-hover'
            onClick={handleChange(item)}
          >
            <FileIcon name={item.name} extension={extension} size='lg' />
            <div className='truncate text-sm text-text-secondary'>{name}</div>
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(DocumentList)
