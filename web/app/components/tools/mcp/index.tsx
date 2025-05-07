'use client'
import React from 'react'
import NewMCPCard from './create-card'
import cn from '@/utils/classnames'

type Props = {
  searchText: string
}

const MCPList = ({
  searchText,
}: Props) => {
  const handleCreate = () => {
    console.log('handleCreate')
  }
  return (
    <>
      <div
        className={cn(
          'relative grid shrink-0 grid-cols-1 content-start gap-4 px-12 pb-4 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
          // 'overflow-hidden',
        )}
      >
        <NewMCPCard handleCreate={handleCreate} />
        {searchText}
      </div>
    </>
  )
}
export default MCPList
