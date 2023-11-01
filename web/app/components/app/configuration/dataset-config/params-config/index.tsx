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
import ParamItem from '@/app/components/base/param-item'
// TODO
const PARAMS_KEY = [
  'top_k',
  'score_threshold',
]
const PARAMS = {
  top_k: {
    default: 2,
    step: 1,
    min: 1,
    max: 10,
  },
  score_threshold: {
    default: 0.7,
    step: 0.01,
    min: 0,
    max: 1,
  },
} as any

const ParamsConfig: FC = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    datasetConfigs,
    setDatasetConfigs,
  } = useContext(ConfigContext)

  const handleParamChange = (key: string, value: number) => {
    let notOutRangeValue = parseFloat(value.toFixed(2))
    notOutRangeValue = Math.max(PARAMS[key].min, notOutRangeValue)
    notOutRangeValue = Math.min(PARAMS[key].max, notOutRangeValue)
    if (key === 'top_k') {
      setDatasetConfigs({
        ...datasetConfigs,
        top_k: notOutRangeValue,
      })
    }
    else if (key === 'score_threshold') {
      setDatasetConfigs({
        ...datasetConfigs,
        [key]: {
          enable: datasetConfigs.score_threshold.enable,
          value: notOutRangeValue,
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
          {PARAMS_KEY.map((key: string) => {
            const currentValue = key === 'top_k' ? datasetConfigs[key] : (datasetConfigs as any)[key].value
            const currentEnableState = key === 'top_k' ? true : (datasetConfigs as any)[key].enable
            return (
              <ParamItem
                key={key}
                id={key}
                name={t(`appDebug.datasetConfig.${key}`)}
                tip={t(`appDebug.datasetConfig.${key}Tip`)}
                {...PARAMS[key]}
                value={currentValue}
                enable={currentEnableState}
                onChange={handleParamChange}
                hasSwitch={key === 'score_threshold'}
                onSwitchChange={handleSwitch}
              />
            )
          })}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default memo(ParamsConfig)
