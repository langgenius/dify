import { cn } from '@langgenius/dify-ui/cn'
import { LeftCorner } from '../../../base/icons/src/vender/plugin'

const CornerMark = ({ className, text }: { className?: string; text: string }) => {
  return (
    <div className={cn('absolute top-0 right-0 flex pl-[13px]', className)}>
      <LeftCorner className="text-background-section" />
      <div className="h-5 rounded-tr-xl bg-background-section pr-2 system-2xs-medium-uppercase leading-5 whitespace-nowrap text-text-tertiary">
        {text}
      </div>
    </div>
  )
}

export default CornerMark
