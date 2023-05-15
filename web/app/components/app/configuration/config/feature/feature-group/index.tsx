'use client'
import React, { FC } from 'react'
import GroupName from '@/app/components/app/configuration/base/group-name'

export interface IFeatureGroupProps {
  title: string
  description?: string
  children: React.ReactNode
}

const FeatureGroup: FC<IFeatureGroupProps> = ({
  title,
  description,
  children
}) => {
  return (
    <div className='mb-6'>
      <div className='mb-2'>
        <GroupName name={title} />
        {description && (
          <div className='text-xs font-normal text-gray-500'>{description}</div>
        )}
      </div>
      <div className='space-y-2'>
        {children}
      </div>
    </div>
  )
}
export default React.memo(FeatureGroup)
