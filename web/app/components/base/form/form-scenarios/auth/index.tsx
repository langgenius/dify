import { memo } from 'react'
import { BaseForm } from '../../components/base'
import type { BaseFormProps } from '../../components/base'

const AuthForm = ({
  formSchemas = [],
  defaultValues,
  ref,
  formFromProps,
}: BaseFormProps) => {
  return (
    <BaseForm
      ref={ref}
      formSchemas={formSchemas}
      defaultValues={defaultValues}
      formClassName='space-y-4'
      labelClassName='h-6 flex items-center mb-1 system-sm-medium text-text-secondary'
      formFromProps={formFromProps}
    />
  )
}

export default memo(AuthForm)
