import type { DataSourceCredential } from '@/types/pipeline'
import * as React from 'react'
import Item from './item'

type ListProps = {
  currentCredentialId: string
  credentials: Array<DataSourceCredential>
  onCredentialChange: (credentialId: string) => void
}

const List = ({
  currentCredentialId,
  credentials,
  onCredentialChange,
}: ListProps) => {
  return (
    <div className="flex w-[280px] flex-col gap-y-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
      {
        credentials.map((credential) => {
          const isSelected = credential.id === currentCredentialId
          return (
            <Item
              key={credential.id}
              credential={credential}
              isSelected={isSelected}
              onCredentialChange={onCredentialChange}
            />
          )
        })
      }
    </div>
  )
}

export default React.memo(List)
