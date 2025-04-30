'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { basePath } from '@/utils/var'
import {
  RiAddLine,
  RiFunctionAddLine,
} from '@remixicon/react'
import Link from './link'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'

type CreateAppCardProps = {
  ref: React.RefObject<HTMLAnchorElement>
}

const CreateAppCard = ({
  ref,
  ..._
}: CreateAppCardProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex h-[166px] flex-col gap-y-0.5 rounded-xl bg-background-default-dimmed'>
      <div className='flex grow flex-col items-center justify-center p-2'>
        <Link href={`${basePath}/datasets/create-from-pipeline`} Icon={RiFunctionAddLine} text={t('dataset.createFromPipeline')} />
        <Link ref={ref} href={`${basePath}/datasets/create`} Icon={RiAddLine} text={t('dataset.createDataset')} />
      </div>
      <div className='border-t-[0.5px] border-divider-subtle p-2'>
        <Link href={`${basePath}/datasets/connect`} Icon={ApiConnectionMod} text={t('dataset.connectDataset')} />
      </div>
    </div>
  )
}

CreateAppCard.displayName = 'CreateAppCard'

export default CreateAppCard
