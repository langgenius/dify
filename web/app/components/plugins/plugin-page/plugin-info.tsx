'use client'
import type { FC } from 'react'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import KeyValueItem from '../base/key-value-item'
import { convertRepoToUrl } from '../install-plugin/utils'

const i18nPrefix = 'pluginInfoModal'
type Props = {
  repository?: string
  release?: string
  packageName?: string
  onHide: () => void
}

const PlugInfo: FC<Props> = ({
  repository,
  release,
  packageName,
  onHide,
}) => {
  const { t } = useTranslation()
  const labelWidthClassName = 'w-[96px]'
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onHide()
      }}
    >
      <DialogContent className="w-full max-w-[480px]! overflow-hidden! border-none text-left align-middle">
        <DialogCloseButton />
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(`${i18nPrefix}.title`, { ns: 'plugin' })}
        </DialogTitle>

        <div className="mt-5 space-y-3">
          {repository && <KeyValueItem label={t(`${i18nPrefix}.repository`, { ns: 'plugin' })} labelWidthClassName={labelWidthClassName} value={`${convertRepoToUrl(repository)}`} valueMaxWidthClassName="max-w-[190px]" />}
          {release && <KeyValueItem label={t(`${i18nPrefix}.release`, { ns: 'plugin' })} labelWidthClassName={labelWidthClassName} value={release} />}
          {packageName && <KeyValueItem label={t(`${i18nPrefix}.packageName`, { ns: 'plugin' })} labelWidthClassName={labelWidthClassName} value={packageName} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(PlugInfo)
