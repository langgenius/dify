'use client'

import { memo } from 'react'
import Workflow from '@/app/components/workflow'
import { useStore } from '@/app/components/app/store'

const Page = () => {
  const appDetail = useStore(s => s.appDetail)!
  return (
    <div className='w-full h-full overflow-x-auto' key={appDetail.id}>
      <Workflow />
    </div>
  )
}
export default memo(Page)
