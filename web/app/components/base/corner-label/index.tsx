import { cn } from '@langgenius/dify-ui/cn'

type CornerLabelProps = {
  label: string
  className?: string
  cornerClassName?: string
  labelClassName?: string
  textClassName?: string
}

const CornerLabel: React.FC<CornerLabelProps> = ({
  label,
  className,
  cornerClassName,
  labelClassName,
  textClassName,
}) => {
  return (
    <div className={cn('group/corner-label inline-flex items-start', className)}>
      <span
        aria-hidden
        className={cn(
          'i-custom-vender-solid-shapes-corner h-5 w-3.25',
          cn('h-5 w-3.25 text-background-section-burn', cornerClassName),
        )}
      />
      <div
        className={cn(
          'flex items-center gap-0.5 bg-background-section-burn py-1 pr-2',
          labelClassName,
        )}
      >
        <div className={cn('system-2xs-medium-uppercase text-text-tertiary', textClassName)}>
          {label}
        </div>
      </div>
    </div>
  )
}

export default CornerLabel
