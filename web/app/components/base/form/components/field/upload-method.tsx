import cn from '@/utils/classnames'
import type { LabelProps } from '../label'
import { useFieldContext } from '../..'
import Label from '../label'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { useTranslation } from 'react-i18next'
import { TransferMethod } from '@/types/app'
import { useCallback } from 'react'

type UploadMethodFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
}

const UploadMethodField = ({
  label,
  labelOptions,
  className,
}: UploadMethodFieldProps) => {
  const { t } = useTranslation()
  const field = useFieldContext<TransferMethod[]>()

  const { value } = field.state

  const handleUploadMethodChange = useCallback((method: TransferMethod) => {
    field.handleChange(method === TransferMethod.all ? [TransferMethod.local_file, TransferMethod.remote_url] : [method])
  }, [field])

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
      />
      <div className='grid grid-cols-3 gap-2'>
        <OptionCard
          title={t('appDebug.variableConfig.localUpload')}
          selected={value.length === 1 && value.includes(TransferMethod.local_file)}
          onSelect={handleUploadMethodChange.bind(null, TransferMethod.local_file)}
        />
        <OptionCard
          title="URL"
          selected={value.length === 1 && value.includes(TransferMethod.remote_url)}
          onSelect={handleUploadMethodChange.bind(null, TransferMethod.remote_url)}
        />
        <OptionCard
          title={t('appDebug.variableConfig.both')}
          selected={value.includes(TransferMethod.local_file) && value.includes(TransferMethod.remote_url)}
          onSelect={handleUploadMethodChange.bind(null, TransferMethod.all)}
        />
      </div>
    </div>
  )
}

export default UploadMethodField
