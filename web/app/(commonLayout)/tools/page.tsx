'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import React, { useEffect } from 'react'
import Tools from '@/app/components/tools'
import { LOC } from '@/app/components/tools/types'

const Layout: FC = () => {
  const { t } = useTranslation()

  useEffect(() => {
    document.title = `${t('tools.title')} - Dify`
  }, [])

  return (
    <div className='overflow-hidden' style={{
      height: 'calc(100vh - 56px)',
    }}>
      <Tools loc={LOC.tools} />
    </div>
  )
}
export default React.memo(Layout)
