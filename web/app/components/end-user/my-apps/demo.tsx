'use client'

import type { EndUserApp, RemoveAppRequest } from './model'
import { useState } from 'react'
import MyApps from '.'
import { demoApps } from './demo-data'

export default function MyAppsDemo() {
  const [apps, setApps] = useState<readonly EndUserApp[]>(demoApps)
  const removeApp = ({ app }: RemoveAppRequest) => {
    // The sample apps have no chat history; both actions only change this in-memory list.
    setApps((current) => current.filter((item) => item.id !== app.id))
  }
  return (
    <MyApps
      apps={apps}
      getAppHref={() => 'https://agent-app.dify.dev/workflow/RWv44MH1ypIb8gs8'}
      onToggleStar={(id) =>
        setApps((current) =>
          current.map((app) => (app.id === id ? { ...app, starred: !app.starred } : app)),
        )
      }
      onRemoveApp={removeApp}
    />
  )
}
