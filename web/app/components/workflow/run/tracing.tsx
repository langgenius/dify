'use client'
import type { FC } from 'react'
// import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
// import cn from 'classnames'
// import Loading from '@/app/components/base/loading'
// import Indicator from '@/app/components/header/indicator'

type TracingProps = {
  appId: string
}

const Tracing: FC<TracingProps> = ({ appId }) => {
  const { t } = useTranslation()
  // const [currentTab, setCurrentTab] = useState<string>(activeTab)

  return (
    <div className='bg-gray-50'>
      Tracing panel = TODO
    </div>
  )
}

export default Tracing
