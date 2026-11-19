'use client'

import { useAtomValue } from 'jotai'
import { useDocLink } from '@/context/i18n'
import { deploymentEditionAtom } from '@/features/system-features/state'

type ChannelDocPage =
  | 'dingtalk'
  | 'email'
  | 'feishu-lark'
  | 'ms-teams'
  | 'overview'
  | 'slack'
  | 'wecom'

export type ChannelDocPath = `/use-dify/workspace/channels/${ChannelDocPage}`

export function useChannelDocLink() {
  const docLink = useDocLink()
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const product = deploymentEdition === 'CLOUD' ? 'cloud' : 'self-host'

  return (path: ChannelDocPath) => {
    // @ts-expect-error Channel guides are not yet in the generated doc paths; remove after syncing dify-docs.
    return docLink(`/${product}${path}`)
  }
}
