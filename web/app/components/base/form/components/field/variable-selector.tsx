import cn from '@/utils/classnames'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import type { LabelProps } from '../label'
import Label from '../label'

type VariableOrConstantInputFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
}

const VariableOrConstantInputField = ({
  className,
  label,
  labelOptions,
}: VariableOrConstantInputFieldProps) => {
  const handleVariableValueChange = () => {
    console.log('Variable value changed')
  }

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={'variable-or-constant'}
        label={label}
        {...(labelOptions ?? {})}
      />
      <div className='flex items-center'>
        <VarReferencePicker
          className='grow'
          nodeId=''
          readonly={false}
          value={[]}
          onChange={handleVariableValueChange}
        />
      </div>
    </div>
  )
}

export default VariableOrConstantInputField
