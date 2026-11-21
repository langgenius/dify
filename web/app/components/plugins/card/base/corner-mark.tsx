import { cn } from '@langgenius/dify-ui/cn'

const CornerMark = ({ className, text }: { className?: string; text: string }) => {
  return (
    <div className={cn('absolute inset-e-0 top-0 flex ps-3.25', className)}>
      <span
        aria-hidden
        className="i-custom-vender-plugin-left-corner h-5 w-3.25 text-background-section"
      />
      <div className="h-5 rounded-se-xl bg-background-section pe-2 system-2xs-medium-uppercase leading-5 whitespace-nowrap text-text-tertiary">
        {text}
      </div>
    </div>
  )
}

export default CornerMark
