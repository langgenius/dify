'use client'

import type { FC } from 'react'
import { forwardRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Thinking as ThinkingIcon } from '@/app/components/base/icons/src/vender/workflow'
import UpgradeModalBase from '@/app/components/base/upgrade-modal'

const Thinking = forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  // eslint-disable-next-line ts/no-explicit-any
  <ThinkingIcon {...props} ref={ref as any} />
))

type Props = {
  show: boolean
  onClose: () => void
  onUpgrade?: () => void
}

const SandboxMigrationModal: FC<Props> = ({
  show,
  onClose,
  onUpgrade,
}) => {
  const { t } = useTranslation()

  const handleUpgrade = useCallback(() => {
    onClose()
    onUpgrade?.()
  }, [onClose, onUpgrade])

  return (
    <UpgradeModalBase
      show={show}
      onClose={onClose}
      Icon={Thinking}
      title={t('sandboxMigrationModal.title', { ns: 'workflow' })}
      description={t('sandboxMigrationModal.description', { ns: 'workflow' })}
      footer={(
        <>
          <Button onClick={onClose}>
            {t('sandboxMigrationModal.dismiss', { ns: 'workflow' })}
          </Button>
          <Button variant="primary" onClick={handleUpgrade}>
            {t('sandboxMigrationModal.upgrade', { ns: 'workflow' })}
          </Button>
        </>
      )}
    />
  )
}

export default SandboxMigrationModal
