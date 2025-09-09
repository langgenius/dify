'use client'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiArrowRightLine,
} from '@remixicon/react'
import Link from 'next/link'

type CreateAppCardProps = {
  ref?: React.Ref<HTMLAnchorElement>
}

const CreateAppCard = ({ ref }: CreateAppCardProps) => {
  const { t } = useTranslation()

  return (
    <div className='bg-background-default-dimm flex min-h-[160px] flex-col rounded-xl border-[0.5px]
      border-components-panel-border transition-all duration-200 ease-in-out'
    >
      <Link ref={ref} className='group flex grow cursor-pointer items-start p-4' href='/datasets/create'>
        <div className='flex items-center gap-3'>
          <div className='flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-divider-regular bg-background-default-lighter
            p-2 group-hover:border-solid group-hover:border-effects-highlight group-hover:bg-background-default-dodge'
          >
            <RiAddLine className='h-4 w-4 text-text-tertiary group-hover:text-text-accent' />
          </div>
          <div className='system-md-semibold text-text-secondary group-hover:text-text-accent'>{t('dataset.createDataset')}</div>
        </div>
      </Link>
      <div className='system-xs-regular p-4 pt-0 text-text-tertiary'>{t('dataset.createDatasetIntro')}</div>
      <Link className='group flex cursor-pointer items-center gap-1 rounded-b-xl border-t-[0.5px] border-divider-subtle p-4' href='/datasets/connect'>
        <div className='system-xs-medium text-text-tertiary group-hover:text-text-accent'>{t('dataset.connectDataset')}</div>
        <RiArrowRightLine className='h-3.5 w-3.5 text-text-tertiary group-hover:text-text-accent' />
      </Link>
    </div>
  )
}

CreateAppCard.displayName = 'CreateAppCard'

export default CreateAppCard
