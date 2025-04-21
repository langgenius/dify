import { useTranslation } from 'react-i18next'
import { withForm } from '../../..'
import type { InputVar } from '@/app/components/workflow/types'
import { getNewVarInWorkflow } from '@/utils/var'
import { useField } from '@tanstack/react-form'
import Label from '../../../components/label'
import { useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { fetchFileUploadConfig } from '@/service/common'
import { useFileSizeLimit } from '@/app/components/base/file-uploader/hooks'
import { formatFileSize } from '@/utils/format'
import InputNumberWithSlider from '@/app/components/workflow/nodes/_base/components/input-number-with-slider'

type MaxNumberOfUploadsFieldProps = {
  initialData?: InputVar
}

const UseMaxNumberOfUploadsField = ({
  initialData,
}: MaxNumberOfUploadsFieldProps) => {
  const MaxNumberOfUploadsField = useMemo(() => {
    return withForm({
      defaultValues: initialData || getNewVarInWorkflow(''),
      render: function Render({
        form,
      }) {
        const { t } = useTranslation()
        const maxNumberOfUploadsField = useField({ form, name: 'max_length' })
        const { value: max_length = 0 } = maxNumberOfUploadsField.state

        const { data: fileUploadConfigResponse } = useSWR({ url: '/files/upload' }, fetchFileUploadConfig)
        const {
          imgSizeLimit,
          docSizeLimit,
          audioSizeLimit,
          videoSizeLimit,
          maxFileUploadLimit,
        } = useFileSizeLimit(fileUploadConfigResponse)

        const handleMaxUploadNumLimitChange = useCallback((value: number) => {
          maxNumberOfUploadsField.handleChange(value)
        }, [maxNumberOfUploadsField])

        return (
          <div className='flex flex-col gap-y-0.5'>
            <Label
              htmlFor='allowed_file_types'
              label={t('appDebug.variableConfig.maxNumberOfUploads')}
            />
          <div>
            <div className='body-xs-regular mb-1.5 text-text-tertiary'>
              {t('appDebug.variableConfig.maxNumberTip', {
                imgLimit: formatFileSize(imgSizeLimit),
                docLimit: formatFileSize(docSizeLimit),
                audioLimit: formatFileSize(audioSizeLimit),
                videoLimit: formatFileSize(videoSizeLimit),
              })}
            </div>

            <InputNumberWithSlider
              value={max_length}
              min={1}
              max={maxFileUploadLimit}
              onChange={handleMaxUploadNumLimitChange}
            />
          </div>
          </div>
        )
      },
    })
  }, [initialData])

  return MaxNumberOfUploadsField
}

export default UseMaxNumberOfUploadsField
