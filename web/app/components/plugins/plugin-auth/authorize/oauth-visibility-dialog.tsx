import type { CredentialPermission } from '@/models/permission'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import PermissionSelector from './permission-selector'

type OAuthVisibilityDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  permission: CredentialPermission
  onPermissionChange: (permission: CredentialPermission) => void
  onConfirm: () => Promise<void> | void
  loading?: boolean
}

const OAuthVisibilityDialog = ({
  open,
  onOpenChange,
  permission,
  onPermissionChange,
  onConfirm,
  loading = false,
}: OAuthVisibilityDialogProps) => {
  const { t } = useTranslation(['common', 'plugin'])
  const handleOpenChange = (nextOpen: boolean) => {
    if (loading && !nextOpen) return
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal={loading}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(($) => $['auth.whoCanUse'], { ns: 'plugin' })}</DialogTitle>
          <DialogDescription>
            {t(($) => $['auth.oauthCredentialPermissionDescription'], { ns: 'plugin' })}
          </DialogDescription>
          <DialogHeaderCloseButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            disabled={loading}
          />
        </DialogHeader>
        <DialogBody>
          <PermissionSelector
            disabled={loading}
            permission={permission}
            onChange={onPermissionChange}
          />
        </DialogBody>
        <DialogFooter>
          <Button disabled={loading} onClick={() => handleOpenChange(false)}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </Button>
          <Button variant="primary" loading={loading} onClick={onConfirm}>
            {t(($) => $['auth.authorize'], { ns: 'plugin' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default memo(OAuthVisibilityDialog)
