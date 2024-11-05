'use client'
import type { FC } from 'react'
import React from 'react'
import type { UpdateFromGitHubPayload } from '../types'

type Props = {
  payload: UpdateFromGitHubPayload
  onSave: () => void
  onCancel: () => void
}

const FromGitHub: FC<Props> = ({
  payload,
}) => {
  return (
    <div>
      {JSON.stringify(payload)}
    </div>
  )
}
export default React.memo(FromGitHub)
