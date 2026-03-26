'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'

type UploadInputsProps = {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  folderInputRef: React.RefObject<HTMLInputElement | null>
  onFileChange: React.ChangeEventHandler<HTMLInputElement>
  onFolderChange: React.ChangeEventHandler<HTMLInputElement>
}

const UploadInputs = ({
  fileInputRef,
  folderInputRef,
  onFileChange,
  onFolderChange,
}: UploadInputsProps) => {
  const { t } = useTranslation('workflow')

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        aria-label={t('skillSidebar.menu.uploadFile')}
        onChange={onFileChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is a non-standard attribute
        webkitdirectory=""
        className="hidden"
        aria-label={t('skillSidebar.menu.uploadFolder')}
        onChange={onFolderChange}
      />
    </>
  )
}

export default React.memo(UploadInputs)
