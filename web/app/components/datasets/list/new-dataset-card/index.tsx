'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiFunctionAddLine,
} from '@remixicon/react'
import Option from './option'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'

const CreateAppCard = () => {
  const { t } = useTranslation()

  return (
    <div className='flex h-[166px] flex-col gap-y-0.5 rounded-xl bg-background-default-dimmed'>
      <div className='flex grow flex-col items-center justify-center p-2'>
        <Option
          href={'/datasets/create'}
          Icon={RiAddLine}
          text={t('dataset.createDataset')}
        />
        <Option
          href={'/datasets/create-from-pipeline'}
          Icon={RiFunctionAddLine}
          text={t('dataset.createFromPipeline')}
        />
      </div>
      <div className='border-t-[0.5px] border-divider-subtle p-2'>
        <Option
          href={'/datasets/connect'}
          Icon={ApiConnectionMod}
          text={t('dataset.connectDataset')}
        />
      </div>
    </div>
  )
}

CreateAppCard.displayName = 'CreateAppCard'

export default CreateAppCard
