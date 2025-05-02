'use client'

import React from 'react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'

type SetURLProps = {
  repoUrl: string
  onChange: (value: string) => void
  onNext: () => void
  onCancel: () => void
}

const SetURL: React.FC<SetURLProps> = ({ repoUrl, onChange, onNext, onCancel }) => {
  const { t } = useTranslation()
  return (
    <>
      <label
        htmlFor='repoUrl'
        className='flex flex-col justify-center items-start self-stretch text-text-secondary'
      >
        <span className='system-sm-semibold'>{t('plugin.installFromGitHub.gitHubRepo')}</span>
      </label>
      <input
        type='url'
        id='repoUrl'
        name='repoUrl'
        value={repoUrl}
        onChange={e => onChange(e.target.value)}
        className='flex items-center self-stretch rounded-lg border border-components-input-border-active
          bg-components-input-bg-active shadows-shadow-xs p-2 gap-[2px] flex-grow overflow-hidden
          text-components-input-text-filled text-ellipsis system-sm-regular'
        placeholder='Please enter GitHub repo URL'
      />
      <div className='flex justify-end items-center gap-2 self-stretch mt-4'>
        <Button
          variant='secondary'
          className='min-w-[72px]'
          onClick={onCancel}
        >
          {t('plugin.installModal.cancel')}
        </Button>
        <Button
          variant='primary'
          className='min-w-[72px]'
          onClick={onNext}
          disabled={!repoUrl.trim()}
        >
          {t('plugin.installModal.next')}
        </Button>
      </div>
    </>
  )
}

export default SetURL
