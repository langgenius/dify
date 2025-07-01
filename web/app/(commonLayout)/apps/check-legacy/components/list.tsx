'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  list: any[]
}

const List: FC<Props> = ({
  list,
}) => {
  return (
    <div>
      {list.length > 0 ? (
        <ul className='list-disc pl-5'>
          {list.map((item, index) => (
            <li key={index} className='system-md-regular text-text-primary'>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <div className='system-md-regular text-text-secondary'>No items found</div>
      )}
    </div>
  )
}
export default React.memo(List)
