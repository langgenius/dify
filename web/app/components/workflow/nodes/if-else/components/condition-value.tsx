import { memo } from 'react'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'

type ConditionValueProps = {
  variable: string
  operator: string
  value: string
}
const ConditionValue = ({
  variable,
  operator,
  value,
}: ConditionValueProps) => {
  const regex = /{{#[^#]*?\.(\w+)#}}/g

  return (
    <div className='flex items-center px-1 h-6 rounded-md bg-workflow-block-parma-bg'>
      <Variable02 className='shrink-0 mr-1 w-3.5 h-3.5 text-text-accent' />
      <div className='shrink-0 max-w-[70px]  min-w-content truncate text-xs font-medium text-text-accent' title={variable}>{variable}</div>
      <div className='shrink-0 max-w-[60px] truncate mx-1 text-xs font-medium text-text-primary' title={operator}>{operator}</div>
      <div className='truncate text-xs text-text-secondary'>{value.replace(regex, '{{$1}}')}</div>
    </div>
  )
}

export default memo(ConditionValue)
