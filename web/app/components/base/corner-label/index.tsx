import { Corner } from '../icons/src/vender/solid/shapes'
import cn from '@/utils/classnames'

type CornerLabelProps = {
  label: string
  className?: string
  labelClassName?: string
}

const CornerLabel: React.FC<CornerLabelProps> = ({ label, className, labelClassName }) => {
  return (
    <div className={cn('group/corner-label inline-flex items-start', className)}>
      <Corner className='text-background-section group-hover/corner-label:text-background-section-burn h-5 w-[13px]' />
      <div className={cn('bg-background-section group-hover/corner-label:bg-background-section-burn flex items-center gap-0.5 py-1 pr-2', labelClassName)}>
        <div className='text-text-tertiary system-2xs-medium-uppercase'>{label}</div>
      </div>
    </div>
  )
}

export default CornerLabel
