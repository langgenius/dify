'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'app.checkLegacy'

type Props = {
  appNum: number,
  publishedNum: number,
}

const Header: FC<Props> = ({
  appNum,
  publishedNum,
}) => {
  const { t } = useTranslation()
  return (
    <div>
      <div className='title-2xl-semi-bold text-text-primary'>{t(`${i18nPrefix}.title`)}</div>
      <div className='system-md-regular mt-1 text-text-tertiary'>{t(`${i18nPrefix}.description`, { num: appNum, publishedNum })}</div>
    </div>
  )
}

export default React.memo(Header)
