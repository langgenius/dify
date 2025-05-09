import React from 'react'
import { RiDatabase2Fill } from '@remixicon/react'

type DatasourceProps = {
  title: string
}

const Datasource = ({
  title,
}: DatasourceProps) => {
  return (
    <div className='flex items-center gap-x-1.5'>
      <div className='flex size-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default'>
        <RiDatabase2Fill className='size-3.5 text-text-secondary' />
      </div>
      <span className='system-sm-medium text-text-secondary'>{title}</span>
    </div>
  )
}

export default React.memo(Datasource)
