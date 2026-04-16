import type { FC } from 'react'
import {
  RiSparklingFill,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type INoDataProps = {}
const NoData: FC<INoDataProps> = () => {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <RiSparklingFill className="h-12 w-12 text-text-empty-state-icon" />
      <div
        className="mt-2 system-sm-regular text-text-quaternary"
      >
        {t('generation.noData', { ns: 'share' })}
      </div>
    </div>
  )
}
export default React.memo(NoData)
