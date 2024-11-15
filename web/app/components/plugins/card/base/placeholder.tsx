import { Group } from '../../../base/icons/src/vender/other'
import Title from './title'
import cn from '@/utils/classnames'

type Props = {
  wrapClassName: string
  loadingFileName?: string
}

export const LoadingPlaceholder = ({ className }: { className?: string }) => (
  <div className={cn('h-2 rounded-sm opacity-20 bg-text-quaternary', className)} />
)

const Placeholder = ({
  wrapClassName,
  loadingFileName,
}: Props) => {
  return (
    <div className={wrapClassName}>
      <div className="flex">
        <div
          className='flex w-10 h-10 p-1 justify-center items-center gap-2 rounded-[10px]
              border-[0.5px] border-components-panel-border bg-background-default backdrop-blur-sm'>
          <div className='flex w-5 h-5 justify-center items-center'>
            <Group className='text-text-tertiary' />
          </div>
        </div>
        <div className="ml-3 grow">
          <div className="flex items-center h-5">
            {loadingFileName ? (
              <Title title={loadingFileName} />
            ) : (
              <LoadingPlaceholder className="w-[260px]" />
            )}
          </div>
          <div className={cn('flex items-center h-4 space-x-0.5')}>
            <LoadingPlaceholder className="w-[41px]" />
            <span className='shrink-0 text-text-quaternary system-xs-regular'>
              ·
            </span>
            <LoadingPlaceholder className="w-[180px]" />
          </div>
        </div>
      </div>
      <LoadingPlaceholder className="mt-3 w-[420px]" />
    </div>
  )
}

export default Placeholder
