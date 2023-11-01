'use client'
import type { FC } from 'react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import { Settings04 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ConfigContext from '@/context/debug-configuration'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'

const ParamsConfig: FC = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    datasetConfigs,
    setDatasetConfigs,
  } = useContext(ConfigContext)

  const handleParamChange = (key: string, value: number) => {
    if (key === 'top_k') {
      setDatasetConfigs({
        ...datasetConfigs,
        top_k: value,
      })
    }
    else if (key === 'score_threshold') {
      setDatasetConfigs({
        ...datasetConfigs,
        [key]: {
          enable: datasetConfigs.score_threshold.enable,
          value,
        },
      })
    }
  }

  const handleSwitch = (key: string, enable: boolean) => {
    if (key === 'top_k')
      return

    setDatasetConfigs({
      ...datasetConfigs,
      [key]: {
        enable,
        value: (datasetConfigs as any)[key].value,
      },
    })
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className={cn('flex items-center rounded-md h-7 px-3 space-x-1 text-gray-700 cursor-pointer hover:bg-gray-200', open && 'bg-gray-200')}>
          <Settings04 className="w-[14px] h-[14px]" />
          <div className='text-xs font-medium'>
            {t('appDebug.datasetConfig.params')}
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 50 }}>
        <div className='w-[240px] p-4 bg-white rounded-lg border-[0.5px] border-gray-200 shadow-lg space-y-3'>
          <TopKItem
            value={datasetConfigs.top_k}
            onChange={handleParamChange}
            enable={true}
          />
          <ScoreThresholdItem
            value={datasetConfigs.score_threshold.value}
            onChange={handleParamChange}
            enable={datasetConfigs.score_threshold.enable}
            hasSwitch={true}
            onSwitchChange={handleSwitch}
          />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default memo(ParamsConfig)
