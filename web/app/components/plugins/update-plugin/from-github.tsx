'use client'
import type { FC } from 'react'
import React from 'react'
import type { UpdateFromGitHubPayload } from '../types'
import InstallFromGitHub from '../install-plugin/install-from-github'

type Props = {
  payload: UpdateFromGitHubPayload
  onSave: () => void
  onCancel: () => void
}

const FromGitHub: FC<Props> = ({
  payload,
  onSave,
  onCancel,
}) => {
  return (
    <InstallFromGitHub
      updatePayload={payload}
      onClose={onCancel}
      onSuccess={onSave}
    />
  )
}
export default React.memo(FromGitHub)
