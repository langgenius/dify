import type { ComponentProps } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { createDialogHandle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import ConfigureConnectionsButton from '../configure-connections-button'
import ConfigureConnectionsDialog from '../configure-connections-dialog'

type Props = Omit<ComponentProps<typeof ConfigureConnectionsDialog>, 'handle'>

export default function ConfigureConnectionsFixture({ services, ...props }: Props) {
  const [handle] = useState(() => createDialogHandle())
  return (
    <>
      <DialogTrigger handle={handle} render={<ConfigureConnectionsButton services={services} />} />
      <DialogTrigger handle={handle} render={<Button variant="secondary-accent" />}>
        Manage connection
      </DialogTrigger>
      <ConfigureConnectionsDialog handle={handle} services={services} {...props} />
    </>
  )
}
