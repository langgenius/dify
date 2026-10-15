'use client'

import type { ConnectionProvider, EndUserConnection } from './model'
import { useState } from 'react'
import ProviderConnections from './provider-connections'
import ProviderHeader from './provider-header'

type Props = {
  provider: ConnectionProvider
  initialConnections: readonly EndUserConnection[]
}

export default function ProviderConnectionsDemo({ provider, initialConnections }: Props) {
  const [connections, setConnections] = useState(initialConnections)

  return (
    <>
      <ProviderHeader provider={provider} />
      <div className="px-5 pt-2 pb-8 sm:px-8">
        <ProviderConnections
          provider={provider}
          connections={connections}
          onRemove={(connection) => {
            setConnections((current) => current.filter((item) => item.id !== connection.id))
          }}
        />
      </div>
    </>
  )
}
