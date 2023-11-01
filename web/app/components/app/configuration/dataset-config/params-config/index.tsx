'use client'
import type { FC } from 'react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import { Settings04 } from '@/app/components/base/icons/src/vender/line/general'

import ConfigContext from '@/context/debug-configuration'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'

const ParamsConfig: FC = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const {
    datasetConfigs,
    setDatasetConfigs,
  } = useContext(ConfigContext)

  const [tempDataSetConfigs, setTempDataSetConfigs] = useState(datasetConfigs)

  const handleParamChange = (key: string, value: number) => {
    if (key === 'top_k') {
      setTempDataSetConfigs({
        ...tempDataSetConfigs,
        top_k: value,
      })
    }
    else if (key === 'score_threshold') {
      setTempDataSetConfigs({
        ...tempDataSetConfigs,
        [key]: {
          enable: tempDataSetConfigs.score_threshold.enable,
          value,
        },
      })
    }
  }

  const handleSwitch = (key: string, enable: boolean) => {
    if (key === 'top_k')
      return

    setTempDataSetConfigs({
      ...tempDataSetConfigs,
      [key]: {
        enable,
        value: (tempDataSetConfigs as any)[key].value,
      },
    })
  }

  const handleSave = () => {
    setDatasetConfigs(tempDataSetConfigs)
    setOpen(false)
  }

  return (
    <div>
      <div
        className={cn('flex items-center rounded-md h-7 px-3 space-x-1 text-gray-700 cursor-pointer hover:bg-gray-200', open && 'bg-gray-200')}
        onClick={() => {
          setTempDataSetConfigs(datasetConfigs)
          setOpen(true)
        }}
      >
        <Settings04 className="w-[14px] h-[14px]" />
        <div className='text-xs font-medium'>
          {t('appDebug.datasetConfig.params')}
        </div>
      </div>
      {
        open && (
          <Modal
            isShow={open}
            onClose={() => {
              setOpen(false)
            }}
            className='w-[528px]'
            wrapperClassName='z-50'
            title={t('appDebug.datasetConfig.settingTitle')}
          >
            <div className='mt-4 space-y-4'>
              <TopKItem
                value={tempDataSetConfigs.top_k}
                onChange={handleParamChange}
                enable={true}
              />
              <ScoreThresholdItem
                value={tempDataSetConfigs.score_threshold.value}
                onChange={handleParamChange}
                enable={tempDataSetConfigs.score_threshold.enable}
                hasSwitch={true}
                onSwitchChange={handleSwitch}
              />
            </div>

            <div className='mt-6 flex justify-end'>
              <Button className='mr-2 flex-shrink-0' onClick={() => {
                setOpen(false)
              }}>{t('common.operation.cancel')}</Button>
              <Button type='primary' className='flex-shrink-0' onClick={handleSave} >{t('common.operation.save')}</Button>
            </div>
          </Modal>
        )
      }

    </div>
  )
}
export default memo(ParamsConfig)
