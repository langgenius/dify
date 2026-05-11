'use client'
import type { FC } from 'react'
import type { Dependency, Plugin, PluginDeclaration } from '../../../types'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { uploadFile } from '@/service/plugins'
import Card from '../../../card'

const i18nPrefix = 'installModal'

type PackageUploadResponse = {
  unique_identifier: string
  manifest: PluginDeclaration
}

type UploadFailureResponse = {
  message?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPackageUploadResponse(value: unknown): value is PackageUploadResponse {
  if (!isObject(value))
    return false

  return typeof value.unique_identifier === 'string' && isObject(value.manifest)
}

function getRejectedResponse(error: unknown): unknown {
  if (!isObject(error) || !('response' in error))
    return undefined

  return error.response
}

function getUploadFailureMessage(response: unknown): string | undefined {
  if (!isObject(response))
    return undefined

  return (response as UploadFailureResponse).message
}

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
  const handleUploadedResponse = React.useCallback((response: unknown) => {
    if (isBundle) {
      if (Array.isArray(response)) {
        onBundleUploaded(response as Dependency[])
        return
      }
      onFailed(t(`${i18nPrefix}.uploadFailed`, { ns: 'plugin' }))
      return
    }

    if (!isPackageUploadResponse(response)) {
      onFailed(t(`${i18nPrefix}.uploadFailed`, { ns: 'plugin' }))
      return
    }

    onPackageUploaded({
      uniqueIdentifier: response.unique_identifier,
      manifest: response.manifest,
    })
  }, [isBundle, onBundleUploaded, onFailed, onPackageUploaded, t])

  const handleUpload = React.useCallback(async () => {
    try {
      handleUploadedResponse(await uploadFile(file, isBundle))
    }
    catch (error: unknown) {
      const response = getRejectedResponse(error)
      const message = getUploadFailureMessage(response)
      if (message) {
        onFailed(message)
        return
      }
      handleUploadedResponse(response)
    }
  }, [file, handleUploadedResponse, isBundle, onFailed])

  React.useEffect(() => {
    handleUpload()
  }, [handleUpload])
  return (
    <>
      <div className="flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3">
        <div className="flex items-center gap-1 self-stretch">
          <span className="i-ri-loader-2-line h-4 w-4 animate-spin-slow text-text-accent" />
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
            payload={{ name: fileName } as Plugin}
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
