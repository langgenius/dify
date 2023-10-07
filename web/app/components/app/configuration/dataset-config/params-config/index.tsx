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
import ConfigContext from '@/context/debug-configuration'

// TODO
const PARAMS_KEY = [
  'top_k',
  'score_threshold',
]
const PARAMS = {
  top_k: {
    enabled: true,
    default: 6,
    step: 1,
    min: 1,
    max: 10,
  },
  score_threshold: {
    enabled: true,
    default: 0.78,
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
  step?: number
  min?: number
  max: number
  onChange: (key: string, value: number) => void
}

const ParamItem: FC<IParamItemProps> = ({ id, name, tip, step = 0.1, min = 0, max, value, onChange }) => {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <span className="mr-1 text-gray-800 text-[13px] leading-[18px] font-medium">{name}</span>
          <Tooltip popupContent={<div className="w-[200px]">{tip}</div>}>
            <HelpCircle className='w-[14px] h-[14px] text-gray-400' />
          </Tooltip>
        </div>
        <div className="flex items-center">
          <input type="number" min={min} max={max} step={step} className="block w-[64px] h-9 leading-9 rounded-lg border-0 pl-1 pl py-1.5 bg-gray-50 text-gray-900  placeholder:text-gray-400 focus:ring-1 focus:ring-inset focus:ring-primary-600" value={value} onChange={(e) => {
            const value = parseFloat(e.target.value)
            if (value < min || value > max)
              return

            onChange(id, value)
          }} />
        </div>
      </div>
      <div className="flex items-center h-7">
        <div className="w-[208px]">
          <Slider
            value={max < 5 ? value * 100 : value}
            min={min < 1 ? min * 100 : min}
            max={max < 5 ? max * 100 : max}
            onChange={value => onChange(id, value / (max < 5 ? 100 : 1))}
          />
        </div>
      </div>
    </div>
  )
}

const ParamsConfig: FC = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    datasetConfigParams,
    setDatasetConfigParams,
  } = useContext(ConfigContext)

  const handleParamChange = (key: string, value: number) => {
    let notOutRangeValue = parseFloat(value.toFixed(2))
    notOutRangeValue = Math.max(PARAMS[key].min, notOutRangeValue)
    notOutRangeValue = Math.min(PARAMS[key].max, notOutRangeValue)

    setDatasetConfigParams({
      ...datasetConfigParams,
      [key]: notOutRangeValue,
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
          {PARAMS_KEY.map(key => (
            <ParamItem
              key={key}
              id={key}
              name={t(`appDebug.datasetConfig.${key}`)}
              tip={t(`appDebug.datasetConfig.${key}Tip`)}
              {...PARAMS[key]}
              value={(datasetConfigParams as any)[key]}
              onChange={handleParamChange}
            />
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default memo(ParamsConfig)
