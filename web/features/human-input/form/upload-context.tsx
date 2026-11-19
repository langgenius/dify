import type { ReactNode } from 'react'
import type { FileUploadStrategy } from '@/app/components/base/file-uploader/upload-context'
import type { HumanInputFormData } from '@/types/workflow'
import { useMemo } from 'react'
import {
  FileUploadContext,
  useFileUploadContext,
} from '@/app/components/base/file-uploader/upload-context'
import { uploadHumanInputFormLocalFile, uploadHumanInputFormRemoteFileInfo } from '@/service/share'
import { resolveWebAppAddress } from '@/service/webapp-address'

/** Bind public run form uploads to their delivery; Console and trial uploads keep their authenticated transport. */
export function HumanInputFormUploadContext({
  formData,
  children,
}: {
  formData: Pick<HumanInputFormData, 'form_token' | 'form_version'>
  children: ReactNode
}) {
  const inherited = useFileUploadContext()
  const { form_token: formToken, form_version: formVersion } = formData
  const isWebApp = resolveWebAppAddress() !== null
  const context = useMemo(() => {
    if (!isWebApp || !formToken) return inherited
    return {
      ...inherited,
      uploadStrategy: {
        uploadLocal: (params: Parameters<FileUploadStrategy['uploadLocal']>[0]) => {
          void uploadHumanInputFormLocalFile({ ...params, formToken, formVersion })
        },
        uploadRemote: (url: string) =>
          uploadHumanInputFormRemoteFileInfo(formToken, url, formVersion),
      },
    }
  }, [inherited, isWebApp, formToken, formVersion])

  return <FileUploadContext value={context}>{children}</FileUploadContext>
}
