import { cn } from '@langgenius/dify-ui/cn'
import {
  SkeletonContainer,
  SkeletonPoint,
  SkeletonRectangle,
  SkeletonRow,
} from '@/app/components/base/skeleton'
import { Group } from '../../../base/icons/src/vender/other'
import Title from './title'

type Props = Readonly<{
  wrapClassName: string
  loadingFileName?: string
}>

export const LoadingPlaceholder = ({ className }: { className?: string }) => (
  <div className={cn('h-2 rounded-xs bg-text-quaternary opacity-20', className)} />
)

const Placeholder = ({ wrapClassName, loadingFileName }: Props) => {
  return (
    <div className={cn(wrapClassName, 'p-3')}>
      <SkeletonRow>
        <div className="flex h-10 w-10 items-center justify-center gap-2 rounded-[10px] border-[0.5px] border-components-panel-border bg-background-default p-1 backdrop-blur-xs">
          <div className="flex size-5 items-center justify-center">
            <Group className="text-text-tertiary" />
          </div>
        </div>
        <div className="grow">
          <SkeletonContainer>
            <div className="flex h-5 items-center">
              {loadingFileName ? (
                <Title title={loadingFileName} />
              ) : (
                <SkeletonRectangle className="w-65" />
              )}
            </div>
            <SkeletonRow className="h-4">
              <SkeletonRectangle className="w-10.25" />
              <SkeletonPoint />
              <SkeletonRectangle className="w-45" />
            </SkeletonRow>
          </SkeletonContainer>
        </div>
      </SkeletonRow>
      <SkeletonRectangle className="mt-3 w-105" />
    </div>
  )
}

export default Placeholder
