'use client'
import type { FC } from 'react'
import type { Dependency, PluginDeclaration } from '../../../types'
import { RiLoader2Line } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { uploadFile } from '@/service/plugins'
import Card from '../../../card'

const i18nPrefix = 'installModal'

type Props = {
  isBundle: boolean
  file: File
  onCancel: () => void
  onPackageUploaded: (result: {
    uniqueIdentifier: string
    manifest: PluginDeclaration
  }) => void
  onBundleUploaded: (result: Dependency[]) => void
  onFailed: (errorMsg: string) => void
}

const Uploading: FC<Props> = ({
  isBundle,
  file,
  onCancel,
  onPackageUploaded,
  onBundleUploaded,
  onFailed,
}) => {
  const { t } = useTranslation()
  const fileName = file.name
  const handleUpload = async () => {
    try {
      await uploadFile(file, isBundle)
    }
    catch (e: any) {
      if (e.response?.message) {
        onFailed(e.response?.message)
      }
      else { // Why it would into this branch?
        const res = e.response
        if (isBundle) {
          onBundleUploaded(res)
          return
        }
        onPackageUploaded({
          uniqueIdentifier: res.unique_identifier,
          manifest: res.manifest,
        })
      }
    }
  }

  React.useEffect(() => {
    handleUpload()
  }, [])
  return (
    <>
      <div className="flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3">
        <div className="flex items-center gap-1 self-stretch">
          <RiLoader2Line className="h-4 w-4 animate-spin-slow text-text-accent" />
          <div className="system-md-regular text-text-secondary">
            {t(`${i18nPrefix}.uploadingPackage`, {
              ns: 'plugin',
              packageName: fileName,
            })}
          </div>
        </div>
        <div className="flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl bg-background-section-burn p-2">
          <Card
            className="w-full"
            payload={{ name: fileName } as any}
            isLoading
            loadingFileName={fileName}
            installed={false}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-2 self-stretch p-6 pt-5">
        <Button variant="secondary" className="min-w-[72px]" onClick={onCancel}>
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button
          variant="primary"
          className="min-w-[72px]"
          disabled
        >
          {t(`${i18nPrefix}.install`, { ns: 'plugin' })}
        </Button>
      </div>
    </>
  )
}

export default React.memo(Uploading)
