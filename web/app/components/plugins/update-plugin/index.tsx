'use client'
import type { FC } from 'react'
import type { UpdatePluginModalType } from '../types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { PluginSource } from '../types'
import UpdateFromGitHub from './from-github'
import UpdateFromMarketplace from './from-market-place'

const UpdatePlugin: FC<UpdatePluginModalType> = ({
  type,
  marketPlace,
  github,
  onCancel,
  onSave,
}) => {
  useTranslation(['app', 'common', 'plugin', 'pluginTags'])
  if (type === PluginSource.github) {
    return <UpdateFromGitHub payload={github!} onSave={onSave} onCancel={onCancel} />
  }
  return <UpdateFromMarketplace payload={marketPlace!} onSave={onSave} onCancel={onCancel} />
}
export default React.memo(UpdatePlugin)
