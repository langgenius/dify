import { useDocLink } from '@/context/i18n'
import { RiApps2AddLine, RiBookOpenLine } from '@remixicon/react'
import React from 'react'
import { useTranslation } from 'react-i18next'

const NoLinkedAppsPanel = () => {
  const { t } = useTranslation()
  const docLink = useDocLink()

  return (
    <div className='w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-4'>
      <div className='inline-flex rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle p-2'>
        <RiApps2AddLine className='size-4 text-text-tertiary' />
      </div>
      <div className='my-2 text-xs text-text-tertiary'>{t('common.datasetMenus.emptyTip')}</div>
      <a
        className='mt-2 inline-flex cursor-pointer items-center text-xs text-text-accent'
        href={docLink('/guides/knowledge-base/integrate-knowledge-within-application')}
        target='_blank' rel='noopener noreferrer'
      >
        <RiBookOpenLine className='mr-1 size-4 text-text-accent' />
        {t('common.datasetMenus.viewDoc')}
      </a>
    </div>
  )
}

export default React.memo(NoLinkedAppsPanel)
