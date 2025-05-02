'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import KeyValueItem from '../base/key-value-item'
import Modal from '../../base/modal'
import { convertRepoToUrl } from '../install-plugin/utils'

const i18nPrefix = 'plugin.pluginInfoModal'
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
    <Modal
      title={t(`${i18nPrefix}.title`)}
      className='w-[480px]'
      isShow
      onClose={onHide}
      closable
    >
      <div className='mt-5 space-y-3'>
        {repository && <KeyValueItem label={t(`${i18nPrefix}.repository`)} labelWidthClassName={labelWidthClassName} value={`${convertRepoToUrl(repository)}`} valueMaxWidthClassName='max-w-[190px]' />}
        {release && <KeyValueItem label={t(`${i18nPrefix}.release`)} labelWidthClassName={labelWidthClassName} value={release} />}
        {packageName && <KeyValueItem label={t(`${i18nPrefix}.packageName`)} labelWidthClassName={labelWidthClassName} value={packageName} />}
      </div>
    </Modal>
  )
}
export default React.memo(PlugInfo)
