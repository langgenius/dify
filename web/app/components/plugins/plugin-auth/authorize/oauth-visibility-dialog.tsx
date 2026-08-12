import type { CredentialPermission } from '@/models/permission'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import PermissionSelector from './permission-selector'

type OAuthVisibilityDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  permission: CredentialPermission
  onPermissionChange: (permission: CredentialPermission) => void
  onConfirm: () => void
}

const OAuthVisibilityDialog = ({
  open,
  onOpenChange,
  permission,
  onPermissionChange,
  onConfirm,
}: OAuthVisibilityDialogProps) => {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-120! max-w-[calc(100vw-2rem)]! p-0!">
        <div className="flex flex-col">
          <div className="relative shrink-0 p-6 pr-14 pb-3">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['auth.whoCanUse'], { ns: 'plugin' })}
            </DialogTitle>
            <div className="mt-1 system-xs-regular text-text-tertiary">
              {t(($) => $['auth.oauthCredentialPermissionDescription'], { ns: 'plugin' })}
            </div>
            <DialogCloseButton className="top-5 right-5 size-8 rounded-lg" />
          </div>
          <div className="px-6 py-3">
            <PermissionSelector permission={permission} onChange={onPermissionChange} />
          </div>
          <div className="flex shrink-0 justify-end p-6 pt-5">
            <Button onClick={() => onOpenChange(false)}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button variant="primary" className="ml-2" onClick={onConfirm}>
              {t(($) => $['auth.authorize'], { ns: 'plugin' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default memo(OAuthVisibilityDialog)
