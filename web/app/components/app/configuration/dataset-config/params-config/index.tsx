'use client'
import type { FC } from 'react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import { HelpCircle, Settings04 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Tooltip from '@/app/components/base/tooltip-plus'
import Slider from '@/app/components/base/slider'
import Switch from '@/app/components/base/switch'
import ConfigContext from '@/context/debug-configuration'

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

export type IParamItemProps = {
  id: string
  name: string
  tip: string
  value: number
  enable: boolean
  step?: number
  min?: number
  max: number
  onChange: (key: string, value: number) => void
  onSwitchChange: (key: string, enable: boolean) => void
}

const ParamItem: FC<IParamItemProps> = ({ id, name, tip, step = 0.1, min = 0, max, value, enable, onChange, onSwitchChange }) => {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          {id === 'score_threshold' && (
            <Switch
              size='md'
              defaultValue={enable}
              onChange={async (val) => {
                onSwitchChange(id, val)
              }}
            />
          )}
          <span className="mx-1 text-gray-800 text-[13px] leading-[18px] font-medium">{name}</span>
          <Tooltip popupContent={<div className="w-[200px]">{tip}</div>}>
            <HelpCircle className='w-[14px] h-[14px] text-gray-400' />
          </Tooltip>
        </div>
        <div className="flex items-center"></div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center h-7">
          <div className="w-[148px]">
            <Slider
              disabled={!enable}
              value={max < 5 ? value * 100 : value}
              min={min < 1 ? min * 100 : min}
              max={max < 5 ? max * 100 : max}
              onChange={value => onChange(id, value / (max < 5 ? 100 : 1))}
            />
          </div>
        </div>
        <div className="flex items-center">
          <input disabled={!enable} type="number" min={min} max={max} step={step} className="block w-[48px] h-7 text-xs leading-[18px] rounded-lg border-0 pl-1 pl py-1.5 bg-gray-50 text-gray-900  placeholder:text-gray-400 focus:ring-1 focus:ring-inset focus:ring-primary-600 disabled:opacity-60" value={value} onChange={(e) => {
            const value = parseFloat(e.target.value)
            if (value < min || value > max)
              return

            onChange(id, value)
          }} />
        </div>
      </div>
    </div>
  )
}

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
