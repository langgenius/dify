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
      <Corner className='h-5 w-[13px] text-background-section-burn' />
      <div className={cn('flex items-center gap-0.5 bg-background-section-burn py-1 pr-2', labelClassName)}>
        <div className='system-2xs-medium-uppercase text-text-tertiary'>{label}</div>
      </div>
    </div>
  )
}

export default CornerLabel
