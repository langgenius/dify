import { cn } from '@langgenius/dify-ui/cn'
import styles from './index.module.css'

export function PublisherDeployingMarker() {
  return (
    <span className="relative size-4 shrink-0">
      <span
        aria-hidden
        className="absolute -top-3.5 left-1/2 h-4 w-0.5 -translate-x-1/2 bg-divider-subtle"
      />
      <span aria-hidden className="relative block size-4 overflow-hidden text-text-accent">
        <span
          className={cn(
            'absolute top-[3.224px] left-[3.862px] block h-[5.081px] w-[8.276px]',
            styles.deployingChevronTop,
          )}
        >
          <span className="i-custom-vender-app-publisher-deploying-chevron block size-full" />
        </span>
        <span
          className={cn(
            'absolute top-[6.99px] left-[3.862px] block h-[5.081px] w-[8.276px]',
            styles.deployingChevronBottom,
          )}
        >
          <span className="i-custom-vender-app-publisher-deploying-chevron block size-full" />
        </span>
      </span>
    </span>
  )
}
