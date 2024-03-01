'use client'
import type { FC } from 'react'
// import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
// import cn from 'classnames'
// import Loading from '@/app/components/base/loading'
// import Indicator from '@/app/components/header/indicator'

type ResultProps = {
  appId: string
}

const Result: FC<ResultProps> = ({ appId }) => {
  const { t } = useTranslation()
  // const [currentTab, setCurrentTab] = useState<string>(activeTab)

  return (
    <div className='bg-white'>
      Result panel = TODO
    </div>
  )
}

export default Result
