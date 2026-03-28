import type { ComponentProps, FC, ReactNode } from 'react'
import { cn } from '@/utils/classnames'

export type PreviewContainerProps = ComponentProps<'div'> & {
  header: ReactNode
  mainClassName?: string
  ref?: React.Ref<HTMLDivElement>
}

const PreviewContainer: FC<PreviewContainerProps> = (props) => {
  const { children, className, header, mainClassName, ref, ...rest } = props
  return (
    <div className={className}>
      <div
        {...rest}
        ref={ref}
        className={cn('flex h-full w-full flex-col rounded-tl-xl border-l-[0.5px] border-t-[0.5px] border-components-panel-border bg-background-default-lighter shadow-md shadow-shadow-shadow-5')}
      >
        <header className="border-b border-divider-subtle pb-3 pl-5 pr-4 pt-4">
          {header}
        </header>
        <main className={cn('w-full grow overflow-y-auto px-6 py-5', mainClassName)}>
          {children}
        </main>
      </div>
    </div>
  )
}
PreviewContainer.displayName = 'PreviewContainer'

export default PreviewContainer
