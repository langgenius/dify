import { Group } from '../../../base/icons/src/vender/other'
import Title from './title'
import { SkeletonContainer, SkeletonPoint, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
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
      <SkeletonRow>
        <div
          className='flex w-10 h-10 p-1 justify-center items-center gap-2 rounded-[10px]
              border-[0.5px] border-components-panel-border bg-background-default backdrop-blur-sm'>
          <div className='flex w-5 h-5 justify-center items-center'>
            <Group className='text-text-tertiary' />
          </div>
        </div>
        <div className="grow">
          <SkeletonContainer>
            <div className="flex items-center h-5">
              {loadingFileName ? (
                <Title title={loadingFileName} />
              ) : (
                <SkeletonRectangle className="w-[260px]" />
              )}
            </div>
            <SkeletonRow className="h-4">
              <SkeletonRectangle className="w-[41px]" />
              <SkeletonPoint />
              <SkeletonRectangle className="w-[180px]" />
            </SkeletonRow>
          </SkeletonContainer>
        </div>
      </SkeletonRow>
      <SkeletonRectangle className="mt-3 w-[420px]" />
    </div>
  )
}

export default Placeholder
