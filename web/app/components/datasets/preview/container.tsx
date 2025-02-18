import type { ComponentProps, FC, ReactNode } from 'react'
import { forwardRef } from 'react'
import classNames from '@/utils/classnames'

export type PreviewContainerProps = ComponentProps<'div'> & {
  header: ReactNode
  mainClassName?: string
}

export const PreviewContainer: FC<PreviewContainerProps> = forwardRef((props, ref) => {
  const { children, className, header, mainClassName, ...rest } = props
  return <div className={className}>
    <div
      {...rest}
      ref={ref}
      className={classNames(
        'flex flex-col w-full h-full overflow-y-auto rounded-l-xl border-t-[0.5px] border-l-[0.5px] border-components-panel-border bg-background-default-lighter shadow shadow-shadow-shadow-5',
      )}
    >
      <header className='border-divider-subtle border-b pb-3 pl-5 pr-4 pt-4'>
        {header}
      </header>
      <main className={classNames('py-5 px-6 w-full h-full', mainClassName)}>
        {children}
      </main>
    </div>
  </div>
})
PreviewContainer.displayName = 'PreviewContainer'
