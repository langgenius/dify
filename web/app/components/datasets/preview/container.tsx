import type { ComponentProps, FC, ReactNode } from 'react'
import classNames from '@/utils/classnames'

export type PreviewContainerProps = ComponentProps<'div'> & {
  header: ReactNode
  mainClassName?: string
  ref?: React.Ref<HTMLDivElement>
}

const PreviewContainer: FC<PreviewContainerProps> = (props) => {
  const { children, className, header, mainClassName, ref, ...rest } = props
  return <div className={className}>
    <div
      {...rest}
      ref={ref}
      className={classNames(
        'flex flex-col w-full h-full rounded-tl-xl border-t-[0.5px] border-l-[0.5px] border-components-panel-border bg-background-default-lighter shadow-md shadow-shadow-shadow-5',
      )}
    >
      <header className='border-b border-divider-subtle pb-3 pl-5 pr-4 pt-4'>
        {header}
      </header>
      <main className={classNames('py-5 px-6 w-full grow overflow-y-auto', mainClassName)}>
        {children}
      </main>
    </div>
  </div>
}
PreviewContainer.displayName = 'PreviewContainer'

export default PreviewContainer
