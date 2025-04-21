import { useTranslation } from 'react-i18next'
import { withForm } from '../../..'
import type { InputVar } from '@/app/components/workflow/types'
import { getNewVarInWorkflow } from '@/utils/var'
import { useField } from '@tanstack/react-form'
import Label from '../../../components/label'
import { useCallback, useMemo } from 'react'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { TransferMethod } from '@/types/app'

type UploadMethodFieldProps = {
  initialData?: InputVar
}

const UseUploadMethodField = ({
  initialData,
}: UploadMethodFieldProps) => {
  const UploadMethodField = useMemo(() => {
    return withForm({
      defaultValues: initialData || getNewVarInWorkflow(''),
      render: function Render({
        form,
      }) {
        const { t } = useTranslation()
        const allowFileUploadMethodField = useField({ form, name: 'allowed_file_upload_methods' })
        const { value: allowed_file_upload_methods = [] } = allowFileUploadMethodField.state

        const handleUploadMethodChange = useCallback((method: TransferMethod) => {
          allowFileUploadMethodField.handleChange(method === TransferMethod.all ? [TransferMethod.local_file, TransferMethod.remote_url] : [method])
        }, [allowFileUploadMethodField])

        return (
          <div className='flex flex-col gap-y-0.5'>
            <Label
              htmlFor='allowed_file_types'
              label={t('appDebug.variableConfig.uploadFileTypes')}
            />
            <div className='grid grid-cols-3 gap-2'>
              <OptionCard
                title={t('appDebug.variableConfig.localUpload')}
                selected={allowed_file_upload_methods.length === 1 && allowed_file_upload_methods.includes(TransferMethod.local_file)}
                onSelect={handleUploadMethodChange.bind(null, TransferMethod.local_file)}
              />
              <OptionCard
                title="URL"
                selected={allowed_file_upload_methods.length === 1 && allowed_file_upload_methods.includes(TransferMethod.remote_url)}
                onSelect={handleUploadMethodChange.bind(null, TransferMethod.remote_url)}
              />
              <OptionCard
                title={t('appDebug.variableConfig.both')}
                selected={allowed_file_upload_methods.includes(TransferMethod.local_file) && allowed_file_upload_methods.includes(TransferMethod.remote_url)}
                onSelect={handleUploadMethodChange.bind(null, TransferMethod.all)}
              />
            </div>
          </div>
        )
      },
    })
  }, [initialData])

  return UploadMethodField
}

export default UseUploadMethodField
