import React from 'react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'

type InstalledProps = {
  repoUrl: string
  selectedVersion: string
  selectedPackage: string
  onClose: () => void
}

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className='flex items-center gap-3'>
    <div className='flex-shrink-0 w-[72px] items-center gap-2'>
      <div className='text-text-tertiary system-sm-medium truncate'>
        {label}
      </div>
    </div>
    <div className='flex-grow overflow-hidden'>
      <div className='text-text-secondary text-ellipsis system-sm-medium'>
        {value}
      </div>
    </div>
  </div>
)

const Installed: React.FC<InstalledProps> = ({ repoUrl, selectedVersion, selectedPackage, onClose }) => {
  const { t } = useTranslation()
  return (
    <>
      <div className='text-text-secondary system-md-regular'>The plugin has been installed successfully.</div>
      <div className='flex w-full p-4 flex-col justify-center items-start gap-2 rounded-2xl bg-background-section-burn'>
        {[
          { label: t('plugin.installModal.labels.repository'), value: repoUrl },
          { label: t('plugin.installModal.labels.version'), value: selectedVersion },
          { label: t('plugin.installModal.labels.package'), value: selectedPackage },
        ].map(({ label, value }) => (
          <InfoRow key={label} label={label} value={value} />
        ))}
      </div>
      <div className='flex justify-end items-center gap-2 self-stretch mt-4'>
        <Button
          variant='primary'
          className='min-w-[72px]'
          onClick={onClose}
        >
          {t('plugin.installModal.close')}
        </Button>
      </div>
    </>
  )
}

export default Installed
