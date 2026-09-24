import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { getRouteMetadata } from '@/app/route-metadata'
import InitPasswordPopup from './InitPasswordPopup'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $.adminInitPassword)
}

const Install = () => {
  return (
    <div className={cn('flex min-h-screen w-full justify-center bg-background-default-burn p-6')}>
      <div
        className={cn(
          'flex w-full shrink-0 flex-col rounded-2xl border border-effects-highlight bg-background-default-subtle',
        )}
      >
        <div className="m-auto block w-96">
          <InitPasswordPopup />
        </div>
      </div>
    </div>
  )
}

export default Install
