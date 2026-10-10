'use client'

import type { ResourceAccessTokenRowResponse } from '@dify/contracts/api/console/resource-access-tokens/types.gen'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { useInvalidateResourceAccessTokens } from './use-invalidate-resource-access-tokens'

export default function DeleteTokenDialog({
  row,
  onOpenChange,
}: {
  row: ResourceAccessTokenRowResponse | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const invalidateResourceAccessTokens = useInvalidateResourceAccessTokens()
  const deleteMutation = useMutation(
    consoleQuery.resourceAccessTokens.byTokenId.relations.byRelationId.delete.mutationOptions(),
  )

  const confirmDelete = () => {
    if (!row) return

    deleteMutation.mutate(
      {
        params: {
          relation_id: row.relation_id,
          token_id: row.token_id,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          void invalidateResourceAccessTokens()
        },
      },
    )
  }

  return (
    <AlertDialog open={!!row} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-120 p-6 text-left" backdropProps={{ forceRender: true }}>
        <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['resourceAccessToken.deleteTitle'], { ns: 'accountSettings' })}
        </AlertDialogTitle>
        <AlertDialogDescription className="mt-2 system-sm-regular text-text-tertiary">
          {t(($) => $['resourceAccessToken.deleteDescription'], { ns: 'accountSettings' })}
        </AlertDialogDescription>
        <AlertDialogFooter className="mt-6 p-0">
          <AlertDialogCancelButton>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton disabled={deleteMutation.isPending} onClick={confirmDelete}>
            {t(($) => $['operation.delete'], { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
