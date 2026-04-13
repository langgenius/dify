'use client'
import type { FC } from 'react'
import type { VersionProps } from '../../types'
import * as React from 'react'
import Badge, { BadgeState } from '@/app/components/base/badge/index'

const Version: FC<VersionProps> = ({
  hasInstalled,
  installedVersion,
  toInstallVersion,
}) => {
  return (
    <>
      {
        !hasInstalled
          ? (
              <Badge className="mx-1" size="s" state={BadgeState.Default}>{toInstallVersion}</Badge>
            )
          : (
              <>
                <Badge className="mx-1" size="s" state={BadgeState.Warning}>
                  {`${installedVersion} -> ${toInstallVersion}`}
                </Badge>
                {/* <div className='flex px-0.5 justify-center items-center gap-0.5'>
              <div className='text-text-warning system-xs-medium'>Used in 3 apps</div>
              <RiInformation2Line className='w-4 h-4 text-text-tertiary' />
            </div> */}
              </>
            )
      }
    </>
  )
}
export default React.memo(Version)
