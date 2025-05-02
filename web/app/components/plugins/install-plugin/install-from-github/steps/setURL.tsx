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
        className='flex flex-col items-start justify-center self-stretch text-text-secondary'
      >
        <span className='system-sm-semibold'>{t('plugin.installFromGitHub.gitHubRepo')}</span>
      </label>
      <input
        type='url'
        id='repoUrl'
        name='repoUrl'
        value={repoUrl}
        onChange={e => onChange(e.target.value)}
        className='shadows-shadow-xs system-sm-regular flex grow items-center gap-[2px]
          self-stretch overflow-hidden text-ellipsis rounded-lg border border-components-input-border-active
          bg-components-input-bg-active p-2 text-components-input-text-filled'
        placeholder='Please enter GitHub repo URL'
      />
      <div className='mt-4 flex items-center justify-end gap-2 self-stretch'>
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
