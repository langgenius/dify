'use client'
import { useTranslation } from 'react-i18next'
import Image from 'next/image'
import { useRef } from 'react'
import { useHover } from 'ahooks'
import { IndexingType } from '../../create/step-two'
import { OptionCard } from '../../create/step-two/option-card'
import { indexMethodIcon } from '../../create/icons'
import classNames from '@/utils/classnames'
import type { DataSet } from '@/models/datasets'
import { ChunkingMode } from '@/models/datasets'
import Badge from '@/app/components/base/badge'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'

type IIndexMethodRadioProps = {
  value?: DataSet['indexing_technique']
  onChange: (v?: DataSet['indexing_technique']) => void
  disable?: boolean
  docForm?: ChunkingMode
  currentValue?: DataSet['indexing_technique']
}

const IndexMethodRadio = ({
  value,
  onChange,
  disable,
  docForm,
  currentValue,
}: IIndexMethodRadioProps) => {
  const { t } = useTranslation()
  const economyDomRef = useRef<HTMLDivElement>(null)
  const isHoveringEconomy = useHover(economyDomRef)
  const isEconomyDisabled = currentValue === IndexingType.QUALIFIED
  const options = [
    {
      key: 'high_quality',
      text: <div className='flex items-center'>
        {t('datasetCreation.stepTwo.qualified')}
        <Badge uppercase className='ml-auto border-text-accent-secondary text-text-accent-secondary'>
          {t('datasetCreation.stepTwo.recommend')}
        </Badge>
      </div>,
      desc: t('datasetSettings.form.indexMethodHighQualityTip'),
    },
    {
      key: 'economy',
      text: t('datasetSettings.form.indexMethodEconomy'),
      desc: t('datasetSettings.form.indexMethodEconomyTip'),
    },
  ]

  return (
    <div className={classNames('flex justify-between w-full gap-2')}>
      {
        options.map((option) => {
          const isParentChild = docForm === ChunkingMode.parentChild
          return (
            <PortalToFollowElem
              key={option.key}
              open={
                isHoveringEconomy && option.key === 'economy'
              }
              placement={'top'}
            >
              <PortalToFollowElemTrigger>
                <OptionCard
                  disabled={
                    disable
                    || (isEconomyDisabled && option.key === IndexingType.ECONOMICAL)
                  }
                  isActive={option.key === value}
                  onSwitched={() => {
                    if (isParentChild && option.key === IndexingType.ECONOMICAL)
                      return
                    if (isEconomyDisabled && option.key === IndexingType.ECONOMICAL)
                      return
                    if (!disable)
                      onChange(option.key as DataSet['indexing_technique'])
                  } }
                  icon={
                    <Image
                      src={option.key === 'high_quality' ? indexMethodIcon.high_quality : indexMethodIcon.economical}
                      alt={option.desc}
                    />
                  }
                  title={option.text}
                  description={option.desc}
                  ref={option.key === 'economy' ? economyDomRef : undefined}
                  className={classNames((isEconomyDisabled && option.key === 'economy') && 'cursor-not-allowed')}
                >
                </OptionCard>
              </PortalToFollowElemTrigger>
              <PortalToFollowElemContent style={{ zIndex: 60 }}>
                <div className='p-3 bg-components-tooltip-bg border-components-panel-border text-xs font-medium text-text-secondary rounded-lg shadow-lg'>
                  {t('datasetSettings.form.indexMethodChangeToEconomyDisabledTip')}
                </div>
              </PortalToFollowElemContent>
            </PortalToFollowElem>
          )
        })
      }
    </div>
  )
}

export default IndexMethodRadio
