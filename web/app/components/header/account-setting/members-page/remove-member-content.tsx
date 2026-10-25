import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import {
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

export type RemoveMemberPayload = Pick<AccountWithRoleResponse, 'id' | 'name' | 'email'>

type RemoveMemberContentProps = {
  name: string
  isPending: boolean
  error?: string
  onSubmit: () => void
}

export default function RemoveMemberContent({
  name,
  isPending,
  error,
  onSubmit,
}: RemoveMemberContentProps) {
  const { t } = useTranslation(['common', 'workspaceMembers'])
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>
          {t(($) => $['members.removeFromTeamConfirmTitle'], {
            ns: 'workspaceMembers',
            memberName: name,
          })}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {t(($) => $['members.removeFromTeamConfirmDescription'], { ns: 'workspaceMembers' })}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {error && (
        <AlertDialogBody>
          <p role="alert" className="text-text-destructive">
            {error}
          </p>
        </AlertDialogBody>
      )}
      <AlertDialogFooter>
        <AlertDialogCancelButton disabled={isPending}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton type="submit" loading={isPending}>
          {t(($) => $['operation.confirm'], { ns: 'common' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </form>
  )
}
