'use client'

import type { ResourceAccessTokenRowResponse } from '@dify/contracts/api/console/resource-access-tokens/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
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
          toast.success(t(($) => $['resourceAccessToken.deleted'], { ns: 'accountSettings' }))
          onOpenChange(false)
          void invalidateResourceAccessTokens()
        },
      },
    )
  }

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="w-120 p-6 text-left" backdropProps={{ forceRender: true }}>
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['resourceAccessToken.deleteTitle'], { ns: 'accountSettings' })}
        </DialogTitle>
        <div className="mt-2 system-sm-regular text-text-tertiary">
          {t(($) => $['resourceAccessToken.deleteDescription'], { ns: 'accountSettings' })}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </Button>
          <Button
            variant="primary"
            tone="destructive"
            disabled={deleteMutation.isPending}
            onClick={confirmDelete}
          >
            {t(($) => $['operation.delete'], { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
