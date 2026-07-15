import { Button } from '@langgenius/dify-ui/button'
import styles from './indicator-button.module.css'

type IndicatorButtonProps = {
  index: number
  label: string
  isCurrent: boolean
  isNextSlide: boolean
  autoplayDelay: number
  isPaused: boolean
  onClick: () => void
}

export function IndicatorButton({
  index,
  label,
  isCurrent,
  isNextSlide,
  autoplayDelay,
  isPaused,
  onClick,
}: IndicatorButtonProps) {
  return (
    <Button
      variant="ghost"
      size="small"
      aria-label={label}
      aria-current={isCurrent ? 'true' : undefined}
      onClick={onClick}
      className="group relative size-6 shrink-0 rounded-lg p-0 hover:bg-transparent"
    >
      <span className="relative flex h-5 w-[22px] items-center justify-center overflow-hidden rounded-[7px] p-px inset-ring-1 inset-ring-divider-subtle group-aria-[current=true]:bg-text-primary group-aria-[current=true]:inset-ring-text-primary">
        {isNextSlide && !isCurrent && !isPaused ? (
          <span
            data-progress-ring
            className={styles.progress}
            aria-hidden="true"
            style={{ animationDuration: `${autoplayDelay}ms` }}
          />
        ) : null}
        <span className="relative z-10 flex h-4.5 w-5 items-center justify-center rounded-md bg-components-panel-on-panel-item-bg p-0.5 text-center system-2xs-semibold-uppercase text-text-tertiary transition-colors group-hover:text-text-secondary group-aria-[current=true]:bg-text-primary group-aria-[current=true]:text-components-panel-on-panel-item-bg">
          {String(index + 1).padStart(2, '0')}
        </span>
      </span>
    </Button>
  )
}
