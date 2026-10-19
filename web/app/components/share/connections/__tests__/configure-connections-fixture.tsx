import type { ComponentProps } from 'react'
import { createDialogHandle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import ConfigureConnectionsButton from '../configure-connections-button'
import ConfigureConnectionsDialog from '../configure-connections-dialog'
import ManageConnectionButton from '../manage-connection-button'

type Props = Omit<ComponentProps<typeof ConfigureConnectionsDialog>, 'handle'>

export default function ConfigureConnectionsFixture({ services, ...props }: Props) {
  const [handle] = useState(() => createDialogHandle())
  return (
    <>
      <DialogTrigger handle={handle} render={<ConfigureConnectionsButton services={services} />} />
      <DialogTrigger handle={handle} render={<ManageConnectionButton />} />
      <ConfigureConnectionsDialog handle={handle} services={services} {...props} />
    </>
  )
}
