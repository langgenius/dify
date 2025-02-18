'use client'

import React from 'react'
import type { Item } from '@/app/components/base/select'
import { PortalSelect } from '@/app/components/base/select'
import Button from '@/app/components/base/button'
import type { PluginDeclaration, UpdateFromGitHubPayload } from '../../../types'
import { useTranslation } from 'react-i18next'
import { useGitHubUpload } from '../../hooks'

const i18nPrefix = 'plugin.installFromGitHub'

type SelectPackageProps = {
  updatePayload: UpdateFromGitHubPayload
  repoUrl: string
  selectedVersion: string
  versions: Item[]
  onSelectVersion: (item: Item) => void
  selectedPackage: string
  packages: Item[]
  onSelectPackage: (item: Item) => void
  onUploaded: (result: {
    uniqueIdentifier: string
    manifest: PluginDeclaration
  }) => void
  onFailed: (errorMsg: string) => void
  onBack: () => void
}

const SelectPackage: React.FC<SelectPackageProps> = ({
  updatePayload,
  repoUrl,
  selectedVersion,
  versions,
  onSelectVersion,
  selectedPackage,
  packages,
  onSelectPackage,
  onUploaded,
  onFailed,
  onBack,
}) => {
  const { t } = useTranslation()
  const isEdit = Boolean(updatePayload)
  const [isUploading, setIsUploading] = React.useState(false)
  const { handleUpload } = useGitHubUpload()

  const handleUploadPackage = async () => {
    if (isUploading) return
    setIsUploading(true)
    try {
      const repo = repoUrl.replace('https://github.com/', '')
      await handleUpload(repo, selectedVersion, selectedPackage, (GitHubPackage) => {
        onUploaded({
          uniqueIdentifier: GitHubPackage.unique_identifier,
          manifest: GitHubPackage.manifest,
        })
      })
    }
    catch (e: any) {
      if (e.response?.message)
        onFailed(e.response?.message)
      else
        onFailed(t(`${i18nPrefix}.uploadFailed`))
    }
    finally {
      setIsUploading(false)
    }
  }

  return (
    <>
      <label
        htmlFor='version'
        className='text-text-secondary flex flex-col items-start justify-center self-stretch'
      >
        <span className='system-sm-semibold'>{t(`${i18nPrefix}.selectVersion`)}</span>
      </label>
      <PortalSelect
        value={selectedVersion}
        onSelect={onSelectVersion}
        items={versions}
        installedValue={updatePayload?.originalPackageInfo.version}
        placeholder={t(`${i18nPrefix}.selectVersionPlaceholder`) || ''}
        popupClassName='w-[512px] z-[1001]'
      />
      <label
        htmlFor='package'
        className='text-text-secondary flex flex-col items-start justify-center self-stretch'
      >
        <span className='system-sm-semibold'>{t(`${i18nPrefix}.selectPackage`)}</span>
      </label>
      <PortalSelect
        value={selectedPackage}
        onSelect={onSelectPackage}
        items={packages}
        readonly={!selectedVersion}
        placeholder={t(`${i18nPrefix}.selectPackagePlaceholder`) || ''}
        popupClassName='w-[512px] z-[1001]'
      />
      <div className='mt-4 flex items-center justify-end gap-2 self-stretch'>
        {!isEdit
          && <Button
            variant='secondary'
            className='min-w-[72px]'
            onClick={onBack}
            disabled={isUploading}
          >
            {t('plugin.installModal.back')}
          </Button>
        }
        <Button
          variant='primary'
          className='min-w-[72px]'
          onClick={handleUploadPackage}
          disabled={!selectedVersion || !selectedPackage || isUploading}
        >
          {t('plugin.installModal.next')}
        </Button>
      </div>
    </>
  )
}

export default SelectPackage
