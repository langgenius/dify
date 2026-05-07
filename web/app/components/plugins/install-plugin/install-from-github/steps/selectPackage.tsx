'use client'

import type { PluginDeclaration, UpdateFromGitHubPayload } from '../../../types'
import { Button } from '@langgenius/dify-ui/button'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { handleUpload } from '../../hooks'

const i18nPrefix = 'installFromGitHub'

type SelectOption = {
  value: string | number
  name: string
}

type SelectPackageProps = {
  updatePayload: UpdateFromGitHubPayload
  repoUrl: string
  selectedVersion: string
  versions: SelectOption[]
  onSelectVersion: (item: SelectOption) => void
  selectedPackage: string
  packages: SelectOption[]
  onSelectPackage: (item: SelectOption) => void
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
  const selectedVersionOption = versions.find(item => String(item.value) === selectedVersion) ?? null
  const selectedPackageOption = packages.find(item => String(item.value) === selectedPackage) ?? null

  const handleUploadPackage = async () => {
    if (isUploading)
      return
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
        onFailed(t(`${i18nPrefix}.uploadFailed`, { ns: 'plugin' }))
    }
    finally {
      setIsUploading(false)
    }
  }

  return (
    <>
      <label
        htmlFor="version"
        className="flex flex-col items-start justify-center self-stretch text-text-secondary"
      >
        <span className="system-sm-semibold">{t(`${i18nPrefix}.selectVersion`, { ns: 'plugin' })}</span>
      </label>
      <Select
        value={selectedVersionOption ? String(selectedVersionOption.value) : null}
        onValueChange={(value) => {
          if (!value)
            return
          const selectedItem = versions.find(item => String(item.value) === value)
          if (selectedItem)
            onSelectVersion(selectedItem)
        }}
      >
        <SelectTrigger className="h-9 text-components-input-text-filled">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">
              {selectedVersionOption?.name ?? t(`${i18nPrefix}.selectVersionPlaceholder`, { ns: 'plugin' }) ?? ''}
            </span>
            {!!(updatePayload?.originalPackageInfo.version && selectedVersionOption && selectedVersionOption.value !== updatePayload.originalPackageInfo.version) && (
              <Badge>
                {updatePayload.originalPackageInfo.version}
                {' '}
                {'->'}
                {' '}
                {selectedVersionOption.value}
              </Badge>
            )}
          </div>
        </SelectTrigger>
        <SelectContent popupClassName="w-[512px]">
          {versions.map(item => (
            <SelectItem key={item.value} value={String(item.value)}>
              <SelectItemText>{item.name}</SelectItemText>
              {item.value === updatePayload?.originalPackageInfo.version && (
                <Badge uppercase={true} className="ml-1 shrink-0">INSTALLED</Badge>
              )}
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label
        htmlFor="package"
        className="flex flex-col items-start justify-center self-stretch text-text-secondary"
      >
        <span className="system-sm-semibold">{t(`${i18nPrefix}.selectPackage`, { ns: 'plugin' })}</span>
      </label>
      <Select
        value={selectedPackageOption ? String(selectedPackageOption.value) : null}
        readOnly={!selectedVersion}
        onValueChange={(value) => {
          if (!value)
            return
          const selectedItem = packages.find(item => String(item.value) === value)
          if (selectedItem)
            onSelectPackage(selectedItem)
        }}
      >
        <SelectTrigger className="h-9 text-components-input-text-filled">
          {selectedPackageOption?.name ?? t(`${i18nPrefix}.selectPackagePlaceholder`, { ns: 'plugin' }) ?? ''}
        </SelectTrigger>
        <SelectContent popupClassName="w-[512px]">
          {packages.map(item => (
            <SelectItem key={item.value} value={String(item.value)}>
              <SelectItemText>{item.name}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="mt-4 flex items-center justify-end gap-2 self-stretch">
        {!isEdit
          && (
            <Button
              variant="secondary"
              className="min-w-[72px]"
              onClick={onBack}
              disabled={isUploading}
            >
              {t('installModal.back', { ns: 'plugin' })}
            </Button>
          )}
        <Button
          variant="primary"
          className="min-w-[72px]"
          onClick={handleUploadPackage}
          disabled={!selectedVersion || !selectedPackage || isUploading}
        >
          {t('installModal.next', { ns: 'plugin' })}
        </Button>
      </div>
    </>
  )
}

export default SelectPackage
