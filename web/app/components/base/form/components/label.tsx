import cn from '@/utils/classnames'
import Tooltip from '../../tooltip'

type LabelProps = {
  htmlFor: string
  label: string
  isRequired?: boolean
  showOptional?: boolean
  tooltip?: string
  className?: string
  labelClassName?: string
}

const Label = ({
  htmlFor,
  label,
  isRequired,
  showOptional,
  tooltip,
  labelClassName,
}: LabelProps) => {
  return (
    <div className='flex h-6 items-center'>
      <label
        htmlFor={htmlFor}
        className={cn('system-sm-medium text-text-secondary', labelClassName)}
      >
        {label}
      </label>
      {showOptional && <div className='system-xs-regular ml-1 text-text-tertiary'>(Optional)</div>}
      {isRequired && <div className='system-xs-regular ml-1 text-text-destructive-secondary'>*</div>}
      {tooltip && (
        <Tooltip
          popupContent={
            <div className='w-[200px]'>{tooltip}</div>
          }
          triggerClassName='ml-0.5 w-4 h-4'
        />
      )}
    </div>
  )
}

export default Label
