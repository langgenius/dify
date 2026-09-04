import type { CredentialPermission } from '@/models/permission'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
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
  const { t } = useTranslation()
  const handleOpenChange = (nextOpen: boolean) => {
    if (loading && !nextOpen) return
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal={loading}>
      <DialogContent className="w-120! max-w-[calc(100vw-2rem)]! p-0!">
        <div className="flex flex-col">
          <div className="relative shrink-0 p-6 pr-14 pb-3">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['auth.whoCanUse'], { ns: 'plugin' })}
            </DialogTitle>
            <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
              {t(($) => $['auth.oauthCredentialPermissionDescription'], { ns: 'plugin' })}
            </DialogDescription>
            <DialogClose
              render={
                <IconButton
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                  size="lg"
                  className="absolute top-5 right-5"
                  disabled={loading}
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </IconButton>
              }
            />
          </div>
          <div className="px-6 py-3">
            <PermissionSelector
              disabled={loading}
              permission={permission}
              onChange={onPermissionChange}
            />
          </div>
          <div className="flex shrink-0 justify-end p-6 pt-5">
            <Button disabled={loading} onClick={() => handleOpenChange(false)}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button
              variant="primary"
              className="ml-2"
              loading={loading}
              aria-busy={loading}
              onClick={onConfirm}
            >
              {t(($) => $['auth.authorize'], { ns: 'plugin' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default memo(OAuthVisibilityDialog)
