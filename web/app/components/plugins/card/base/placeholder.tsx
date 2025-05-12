import { Group } from '../../../base/icons/src/vender/other'
import Title from './title'
import { SkeletonContainer, SkeletonPoint, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import cn from '@/utils/classnames'

type Props = {
  wrapClassName: string
  loadingFileName?: string
}

export const LoadingPlaceholder = ({ className }: { className?: string }) => (
  <div className={cn('h-2 rounded-sm bg-text-quaternary opacity-20', className)} />
)

const Placeholder = ({
  wrapClassName,
  loadingFileName,
}: Props) => {
  return (
    <div className={wrapClassName}>
      <SkeletonRow>
        <div
          className='flex h-10 w-10 items-center justify-center gap-2 rounded-[10px] border-[0.5px]
              border-components-panel-border bg-background-default p-1 backdrop-blur-sm'>
          <div className='flex h-5 w-5 items-center justify-center'>
            <Group className='text-text-tertiary' />
          </div>
        </div>
        <div className="grow">
          <SkeletonContainer>
            <div className="flex h-5 items-center">
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
