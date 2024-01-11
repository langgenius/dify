'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { Credential } from '@/app/components/tools/types'
import Drawer from '@/app/components/base/drawer-plus'

type Props = {
  credential: Credential
  onChange: (credential: Credential) => void
  onHide: () => void
}

const ConfigCredential: FC<Props> = ({
  credential,
  onChange,
  onHide,
}) => {
  const { t } = useTranslation()

  return (
    <Drawer
      isShow
      onHide={onHide}
      title={t('tools.createTool.title') as string}
      panelClassName='mt-2 !w-[520px]'
      maxWidthClassName='!max-w-[520px]'
      height='calc(100vh - 16px)'
      headerClassName='!border-b-black/5'
      body={
        <div>

        </div>
      }
    />
  )
}
export default React.memo(ConfigCredential)
