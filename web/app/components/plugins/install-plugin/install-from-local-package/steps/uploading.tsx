'use client'
import type { FC } from 'react'
import React from 'react'
import { RiLoader2Line } from '@remixicon/react'
import Card from '../../../card'
import type { Dependency, PluginDeclaration } from '../../../types'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import { uploadFile } from '@/service/plugins'
const i18nPrefix = 'plugin.installModal'

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        <div className='flex items-center gap-1 self-stretch'>
          <RiLoader2Line className='text-text-accent w-4 h-4 animate-spin-slow' />
          <div className='text-text-secondary system-md-regular'>
            {t(`${i18nPrefix}.uploadingPackage`, {
              packageName: fileName,
            })}
          </div>
        </div>
        <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
          <Card
            className='w-full'
            payload={{ name: fileName } as any}
            isLoading
            loadingFileName={fileName}
            installed={false}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
        <Button variant='secondary' className='min-w-[72px]' onClick={onCancel}>
          {t('common.operation.cancel')}
        </Button>
        <Button
          variant='primary'
          className='min-w-[72px]'
          disabled
        >
          {t(`${i18nPrefix}.install`)}
        </Button>
      </div>
    </>
  )
}

export default React.memo(Uploading)
