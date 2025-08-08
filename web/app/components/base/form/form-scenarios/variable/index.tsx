import { memo } from 'react'
import { BaseForm } from '../../components/base'
import type { BaseFormProps } from '../../components/base'

const VariableForm = ({
  formSchemas = [],
  defaultValues,
  ref,
  formFromProps,
  ...rest
}: BaseFormProps) => {
  return (
    <BaseForm
      ref={ref}
      formSchemas={formSchemas}
      defaultValues={defaultValues}
      formClassName='space-y-3'
      labelClassName='h-6 flex items-center mb-1 system-sm-medium text-text-secondary'
      formFromProps={formFromProps}
      {...rest}
    />
  )
}

export default memo(VariableForm)
