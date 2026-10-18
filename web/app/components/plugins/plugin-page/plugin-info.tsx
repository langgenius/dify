'use client'
import type { FC } from 'react'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import KeyValueItem from '../base/key-value-item'
import { convertRepoToUrl } from '../install-plugin/utils'

const i18nPrefix = 'pluginInfoModal'
type Props = Readonly<{
  repository?: string
  release?: string
  packageName?: string
  onHide: () => void
}>

const PlugInfo: FC<Props> = ({ repository, release, packageName, onHide }) => {
  const { t } = useTranslation(['common', 'plugin'])
  const labelWidthClassName = 'w-[96px]'
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onHide()
      }}
    >
      <DialogContent className="w-120">
        <DialogHeader>
          <DialogTitle>{t(($) => $[`${i18nPrefix}.title`], { ns: 'plugin' })}</DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody className="space-y-3">
          {repository && (
            <KeyValueItem
              label={t(($) => $[`${i18nPrefix}.repository`], { ns: 'plugin' })}
              labelWidthClassName={labelWidthClassName}
              value={`${convertRepoToUrl(repository)}`}
              valueMaxWidthClassName="max-w-[190px]"
            />
          )}
          {release && (
            <KeyValueItem
              label={t(($) => $[`${i18nPrefix}.release`], { ns: 'plugin' })}
              labelWidthClassName={labelWidthClassName}
              value={release}
            />
          )}
          {packageName && (
            <KeyValueItem
              label={t(($) => $[`${i18nPrefix}.packageName`], { ns: 'plugin' })}
              labelWidthClassName={labelWidthClassName}
              value={packageName}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(PlugInfo)
