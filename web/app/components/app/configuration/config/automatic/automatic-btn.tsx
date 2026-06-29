'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  RiSparklingFill,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from '#i18n'

type IAutomaticBtnProps = {
  onClick: () => void
}
const AutomaticBtn: FC<IAutomaticBtnProps> = ({
  onClick,
}) => {
  const { t } = useTranslation()

  return (
    <Button variant="secondary-accent" size="small" onClick={onClick}>
      <RiSparklingFill className="mr-1 size-3.5" />
      <span className="">{t('operation.automatic', { ns: 'appDebug' })}</span>
    </Button>
  )
}
export default React.memo(AutomaticBtn)
