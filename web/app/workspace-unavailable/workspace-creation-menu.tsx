import type { TenantListItemResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  createDialogHandle,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogViewport,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { WorkspaceAvatar } from '@/app/components/base/workspace-avatar'

type WorkspaceCreationMenuProps = {
  currentWorkspace?: Pick<TenantListItemResponse, 'id' | 'name'>
}

export function WorkspaceCreationMenu({ currentWorkspace }: WorkspaceCreationMenuProps) {
  const { t } = useTranslation(['navigation', 'common', 'billing'])
  const [createDialog] = useState(() => createDialogHandle())
  const switchTriggerRef = useRef<HTMLButtonElement>(null)
  const workspaceName = currentWorkspace?.name || currentWorkspace?.id
  const nameLabel = t(($) => $['workspaceUnavailable.workspaceName'])
  const createLabel = t(($) => $['workspaceUnavailable.createWorkspace'])

  return (
    <>
      <Menu>
        <MenuTrigger
          ref={switchTriggerRef}
          render={<Button size="large" variant="tertiary" />}
          className="gap-0.5 ps-4 pe-2 font-medium"
        >
          {t(($) => $['workspaceUnavailable.switchWorkspace'])}
          <span aria-hidden className="i-ri-arrow-down-s-line size-4 text-text-tertiary" />
        </MenuTrigger>
        <MenuContent align="center" className="w-[min(20rem,var(--available-width))] pb-2">
          <MenuGroup>
            <MenuGroupLabel>
              {t(($) => $['userProfile.workspace'], { ns: 'common' })}
            </MenuGroupLabel>
            {currentWorkspace && (
              <MenuRadioGroup value={currentWorkspace.id}>
                <MenuRadioItem
                  value={currentWorkspace.id}
                  disabled
                  className="h-auto min-h-8 gap-2 py-1 ps-1.5 data-disabled:opacity-100 data-highlighted:bg-transparent"
                >
                  <WorkspaceAvatar name={workspaceName} size="sm" className="opacity-35" />
                  <span className="min-w-0 flex-1 system-md-regular wrap-break-word text-text-placeholder">
                    {workspaceName}
                  </span>
                  <Badge
                    as="span"
                    size="xs"
                    variant="dimm"
                    uppercase={false}
                    className="shrink-0 px-1.25 system-2xs-medium!"
                  >
                    {t(($) => $['plansCommon.unavailable'], { ns: 'billing' })}
                  </Badge>
                  <MenuRadioItemIndicator className="ms-0" />
                </MenuRadioItem>
              </MenuRadioGroup>
            )}
            <MenuItem
              aria-haspopup="dialog"
              className={cn(
                buttonVariants({ variant: 'tertiary' }),
                'mx-2.5 mt-1.5 flex data-highlighted:bg-components-button-tertiary-bg-hover',
              )}
              onClick={() => createDialog.open(null)}
            >
              <span aria-hidden className="i-ri-add-line size-4" />
              {createLabel}
            </MenuItem>
          </MenuGroup>
        </MenuContent>
      </Menu>

      <Dialog handle={createDialog}>
        <DialogPortal>
          <DialogBackdrop className="bg-background-gradient-mask-side-panel-2" />
          <DialogViewport className="flex items-center justify-center overflow-hidden p-4">
            <DialogPopup
              className="flex max-h-full w-120 max-w-full flex-col overflow-hidden rounded-[10px] bg-components-panel-bg shadow-lg"
              finalFocus={switchTriggerRef}
            >
              <Form className="contents" onFormSubmit={() => createDialog.close()}>
                <DialogHeader>
                  <DialogTitle>
                    {t(($) => $['workspaceUnavailable.createWorkspaceTitle'])}
                  </DialogTitle>
                  <DialogDescription>
                    {t(($) => $['workspaceUnavailable.createWorkspaceDescription'])}
                  </DialogDescription>
                  <DialogHeaderCloseButton
                    aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                  />
                </DialogHeader>
                <div className="min-h-0 overflow-y-auto px-6 pt-2">
                  <Field name="name" className="gap-2">
                    <FieldLabel className="flex min-h-6 items-center gap-1 py-0 system-md-medium">
                      {nameLabel}
                      <span aria-hidden className="text-text-destructive-secondary">
                        *
                      </span>
                    </FieldLabel>
                    <Input
                      required
                      pattern=".*\S.*"
                      placeholder={t(($) => $['workspaceUnavailable.workspaceNamePlaceholder'])}
                      className="h-9 rounded-[10px] px-3.5 py-0 system-md-regular"
                    />
                    <FieldError>
                      {t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: nameLabel })}
                    </FieldError>
                  </Field>
                </div>
                <DialogFooter>
                  <DialogClose render={<Button className="min-w-18" />}>
                    {t(($) => $['operation.cancel'], { ns: 'common' })}
                  </DialogClose>
                  <Button type="submit" variant="primary" className="min-w-18">
                    {createLabel}
                  </Button>
                </DialogFooter>
              </Form>
            </DialogPopup>
          </DialogViewport>
        </DialogPortal>
      </Dialog>
    </>
  )
}
