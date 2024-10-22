import React from 'react'
import type { Item } from '@/app/components/base/select'
import { PortalSelect } from '@/app/components/base/select'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'

type SetPackageProps = {
  selectedPackage: string
  packages: Item[]
  onSelect: (item: Item) => void
  onInstall: () => void
  onBack: () => void
}

const SetPackage: React.FC<SetPackageProps> = ({ selectedPackage, packages, onSelect, onInstall, onBack }) => {
  const { t } = useTranslation()
  return (
    <>
      <label
        htmlFor='package'
        className='flex flex-col justify-center items-start self-stretch text-text-secondary'
      >
        <span className='system-sm-semibold'>{t('plugin.installFromGitHub.selectPackage')}</span>
      </label>
      <PortalSelect
        value={selectedPackage}
        onSelect={onSelect}
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
          onClick={onInstall}
          disabled={!selectedPackage}
        >
          {t('plugin.installModal.install')}
        </Button>
      </div>
    </>
  )
}

export default SetPackage
