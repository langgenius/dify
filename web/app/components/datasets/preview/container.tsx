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
      <header className='pl-5 pt-4 pr-4 pb-3 border-b border-divider-subtle'>
        {header}
      </header>
      <main className={classNames('py-5 px-6 w-full h-full', mainClassName)}>
        {children}
      </main>
    </div>
  </div>
})
PreviewContainer.displayName = 'PreviewContainer'
