'use client'

import { useEffect } from 'react'
import AppCard from './AppCard'
import NewAppCard from './NewAppCard'
import { useAppContext } from '@/context/app-context'

const Apps = () => {
  const { apps, mutateApps } = useAppContext()

  useEffect(() => {
    mutateApps()
  }, [])

  return (
    <nav className='grid content-start grid-cols-1 gap-4 px-12 pt-8 sm:grid-cols-2 lg:grid-cols-4 grow shrink-0'>
      {apps.map(app => (<AppCard key={app.id} app={app} />))}
      <NewAppCard />
    </nav>
  )
}

export default Apps
