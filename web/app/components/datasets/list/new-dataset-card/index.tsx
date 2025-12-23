'use client'
import {
  RiAddLine,
  RiFunctionAddLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import Option from './option'

const CreateAppCard = () => {
  const { t } = useTranslation()

  return (
    <div className="flex h-[190px] flex-col gap-y-0.5 rounded-xl bg-background-default-dimmed">
      <div className="flex grow flex-col items-center justify-center p-2">
        <Option
          href="/datasets/create"
          Icon={RiAddLine}
          text={t('dataset.createDataset')}
        />
        <Option
          href="/datasets/create-from-pipeline"
          Icon={RiFunctionAddLine}
          text={t('dataset.createFromPipeline')}
        />
      </div>
      <div className="border-t-[0.5px] border-divider-subtle p-2">
        <Option
          href="/datasets/connect"
          Icon={ApiConnectionMod}
          text={t('dataset.connectDataset')}
        />
      </div>
    </div>
  )
}

CreateAppCard.displayName = 'CreateAppCard'

export default CreateAppCard
