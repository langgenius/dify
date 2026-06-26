'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSubmitEnterpriseMarketplaceAsset } from '@/service/use-enterprise-marketplace'

export type SubmitEnterpriseMarketplaceModalProps = {
  appId: string
  open: boolean
  defaultTitle: string
  defaultDescription?: string
  onClose: () => void
}

const SubmitEnterpriseMarketplaceModal = ({
  appId,
  open,
  defaultTitle,
  defaultDescription,
  onClose,
}: SubmitEnterpriseMarketplaceModalProps) => {
  const { t } = useTranslation()
  const submitMarketplaceMutation = useSubmitEnterpriseMarketplaceAsset(appId)
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState(defaultDescription || '')
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState('')
  const [scenario, setScenario] = useState('')
  const [allowShowWorkspaceName, setAllowShowWorkspaceName] = useState(false)

  const normalizedTags = useMemo(() => tags
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean), [tags])

  const handleSubmit = () => {
    submitMarketplaceMutation.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        category: category.trim() || 'General',
        tags: normalizedTags,
        scenario: scenario.trim(),
        allow_show_workspace_name: allowShowWorkspaceName,
      },
      {
        onSuccess: () => {
          onClose()
          toast.success(t('enterpriseMarketplace.submitSuccess', { ns: 'common' }))
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : t('enterpriseMarketplace.submitFailed', { ns: 'common' }),
          )
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && onClose()}>
      <DialogContent className="max-w-[640px] p-0">
        <div className="p-6 pb-4">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t('enterpriseMarketplace.submitDialogTitle', { ns: 'common' })}
          </DialogTitle>
        </div>
        <div className="space-y-4 px-6 pb-4">
          <div>
            <div className="mb-2 text-sm text-text-secondary">
              {t('enterpriseMarketplace.titleLabel', { ns: 'common' })}
            </div>
            <Input value={title} onValueChange={setTitle} maxLength={255} />
          </div>
          <div>
            <div className="mb-2 text-sm text-text-secondary">
              {t('enterpriseMarketplace.descriptionLabel', { ns: 'common' })}
            </div>
            <Textarea value={description} onValueChange={setDescription} maxLength={5000} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 text-sm text-text-secondary">
                {t('enterpriseMarketplace.categoryLabel', { ns: 'common' })}
              </div>
              <Input
                value={category}
                onValueChange={setCategory}
                placeholder={t('enterpriseMarketplace.categoryPlaceholder', { ns: 'common' })}
                maxLength={255}
              />
            </div>
            <div>
              <div className="mb-2 text-sm text-text-secondary">
                {t('enterpriseMarketplace.tagsLabel', { ns: 'common' })}
              </div>
              <Input
                value={tags}
                onValueChange={setTags}
                placeholder={t('enterpriseMarketplace.tagsPlaceholder', { ns: 'common' })}
              />
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm text-text-secondary">
              {t('enterpriseMarketplace.scenarioLabel', { ns: 'common' })}
            </div>
            <Textarea
              value={scenario}
              onValueChange={setScenario}
              placeholder={t('enterpriseMarketplace.scenarioPlaceholder', { ns: 'common' })}
              maxLength={5000}
            />
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-divider-subtle bg-background-body px-4 py-3">
            <Checkbox checked={allowShowWorkspaceName} onCheckedChange={setAllowShowWorkspaceName} />
            <div>
              <div className="system-sm-medium text-text-primary">
                {t('enterpriseMarketplace.showWorkspaceName', { ns: 'common' })}
              </div>
              <div className="mt-1 system-xs-regular text-text-tertiary">
                {t('enterpriseMarketplace.showWorkspaceNameTip', { ns: 'common' })}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-divider-subtle px-6 py-4">
          <Button onClick={onClose}>
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            variant="primary"
            loading={submitMarketplaceMutation.isPending}
            disabled={!title.trim()}
            onClick={handleSubmit}
          >
            {t('enterpriseMarketplace.submitAction', { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SubmitEnterpriseMarketplaceModal
