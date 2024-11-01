'use client'

import React from 'react'
import type { Item } from '@/app/components/base/select'
import { PortalSelect } from '@/app/components/base/select'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'

type SelectPackageProps = {
  selectedVersion: string
  versions: Item[]
  onSelectVersion: (item: Item) => void
  selectedPackage: string
  packages: Item[]
  onSelectPackage: (item: Item) => void
  onNext: () => void
  onBack: () => void
}

const SelectPackage: React.FC<SelectPackageProps> = ({
  selectedVersion,
  versions,
  onSelectVersion,
  selectedPackage,
  packages,
  onSelectPackage,
  onNext,
  onBack,
}) => {
  const { t } = useTranslation()
  return (
    <>
      <label
        htmlFor='version'
        className='flex flex-col justify-center items-start self-stretch text-text-secondary'
      >
        <span className='system-sm-semibold'>{t('plugin.installFromGitHub.selectVersion')}</span>
      </label>
      <PortalSelect
        value={selectedVersion}
        onSelect={onSelectVersion}
        items={versions}
        placeholder={t('plugin.installFromGitHub.selectVersionPlaceholder') || ''}
        popupClassName='w-[432px] z-[1001]'
      />
      <label
        htmlFor='package'
        className='flex flex-col justify-center items-start self-stretch text-text-secondary'
      >
        <span className='system-sm-semibold'>{t('plugin.installFromGitHub.selectPackage')}</span>
      </label>
      <PortalSelect
        value={selectedPackage}
        onSelect={onSelectPackage}
        items={packages}
        placeholder={t('plugin.installFromGitHub.selectPackagePlaceholder') || ''}
        popupClassName='w-[432px] z-[1001]'
      />
      <div className='flex justify-end items-center gap-2 self-stretch mt-4'>
        <Button
          variant='secondary'
          className='min-w-[72px]'
          onClick={onBack}
        >
          {t('plugin.installModal.back')}
        </Button>
        <Button
          variant='primary'
          className='min-w-[72px]'
          onClick={onNext}
          disabled={!selectedVersion || !selectedPackage}
        >
          {t('plugin.installModal.next')}
        </Button>
      </div>
    </>
  )
}

export default SelectPackage
