'use client'
import cn from 'classnames'
import { useSystemFeaturesStore } from '../store'
import s from './styles.module.css'

const LicenseInfo = () => {
  const { systemFeatures } = useSystemFeaturesStore()

  if (systemFeatures.expired_at) {
    return (
      <div className='fixed inset-0 flex flex-col pt-14 z-[99999]'>
        <div className={cn(s.bg, 'grow flex flex-col items-center justify-center bg-white')}>
          <div className='mb-3 text-xl font-semibold'>
            Your organization's Dify Enterprise license has expired.
          </div>
          <div className='text-gray-300'>
            Please contact your administrator to continue using Dify.
          </div>
        </div>
      </div>
    )
  }

  return null
}

export default LicenseInfo