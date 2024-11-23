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
      <Corner className='w-[13px] h-5 text-background-section group-hover/corner-label:text-background-section-burn' />
      <div className={cn('flex py-1 pr-2 items-center gap-0.5 bg-background-section group-hover/corner-label:bg-background-section-burn', labelClassName)}>
        <div className='text-text-tertiary system-2xs-medium-uppercase'>{label}</div>
      </div>
    </div>
  )
}

export default CornerLabel
