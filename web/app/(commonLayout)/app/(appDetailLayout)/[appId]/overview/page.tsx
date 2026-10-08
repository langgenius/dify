import { Suspense } from 'react'
import * as React from 'react'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import OverviewView from './view'

export type IDevelopProps = {
  params: Promise<{ appId: string }>
}

const Overview = async (props: IDevelopProps) => {
  const params = await props.params

  const { appId } = params

  return (
    <Suspense
      fallback={
        <SkeletonContainer className="gap-4 p-6" aria-busy="true">
          <SkeletonRectangle className="h-6 w-48" />
          <SkeletonRectangle className="h-10 w-full" />
          <SkeletonRectangle className="h-96 w-full" />
        </SkeletonContainer>
      }
    >
      <OverviewView appId={appId} />
    </Suspense>
  )
}

export default Overview
