import type { FC } from 'react'
import { twc } from '@/utils/twc'

export const SkeletonContanier = twc.div`flex flex-col gap-1`

export const SkeletonRow = twc.div`flex items-center gap-2`

export const SkeletonRectangle = twc.div`h-2 rounded-sm opacity-20 bg-text-tertiary my-1`

export const SkeletonCircle: FC = () =>
  <div className='text-text-quaternary text-xs font-medium'>·</div>

/** Usage
 * <SkeletonContanier>
 *  <SkeletonRow>
 *    <SkeletonRectangle className="w-96" />
 *    <SkeletonCircle />
 *    <SkeletonRectangle className="w-96" />
 *  </SkeletonRow>
 *  <SkeletonRow>
 *    <SkeletonRectangle className="w-96" />
 *  </SkeletonRow>
 * <SkeletonRow>
 */
