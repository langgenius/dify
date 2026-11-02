import { Suspense } from 'react'
import * as React from 'react'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import OverviewView from './view'

export type IDevelopProps = {
  params: Promise<{ appId: string }>
}

const Overview = async (props: IDevelopProps) => {
  const params = await props.params

  const { appId } = params

  return (
    <Suspense fallback={<LoadingPlaceholder className="h-full" />}>
      <OverviewView appId={appId} />
    </Suspense>
  )
}

export default Overview
