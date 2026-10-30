'use client'
import type { Annotation } from '@dify/contracts/api/console/apps/types.gen'
import type { AnnotationEditorProps } from '../edit-annotation-modal/annotation-editor'
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'
import { AnnotationEditor } from '../edit-annotation-modal/annotation-editor'
import { RemoveAnnotationDialog } from '../edit-annotation-modal/remove-annotation-dialog'
import { AnnotationHitHistory } from './hit-history'

type AnnotationDetailsProps = {
  appId: string
  item: Annotation
  isPending: boolean
  isError: boolean
  onSave: AnnotationEditorProps['onSave']
  onRemoved: () => void
}

export default function AnnotationDetails({
  appId,
  item,
  isPending,
  isError,
  onSave,
  onRemoved,
}: AnnotationDetailsProps) {
  const { t } = useTranslation(['appAnnotation', 'appLog', 'common'])
  const { formatTime } = useTimestamp()
  const [tab, setTab] = useState('annotation')
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(($) => $['viewModal.annotatedResponse'], { ns: 'appAnnotation' })}
        </DialogTitle>
        <DialogHeaderCloseButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          disabled={isPending}
        />
      </DialogHeader>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-6 shrink-0">
          <TabsTab value="annotation">
            {t(($) => $['viewModal.annotatedResponse'], { ns: 'appAnnotation' })}
          </TabsTab>
          <TabsTab value="history" disabled={isPending}>
            {t(($) => $['viewModal.hitHistory'], { ns: 'appAnnotation' })}
          </TabsTab>
        </TabsList>
        <DialogBody>
          <TabsPanel value="annotation" keepMounted>
            <AnnotationEditor
              question={item.question ?? ''}
              answer={item.answer ?? ''}
              isPending={isPending}
              isError={isError}
              onSave={onSave}
            />
          </TabsPanel>
          <TabsPanel value="history">
            <AnnotationHitHistory appId={appId} annotationId={item.id} />
          </TabsPanel>
        </DialogBody>
      </Tabs>
      {tab === 'annotation' && (
        <DialogFooter>
          <RemoveAnnotationDialog
            appId={appId}
            annotationId={item.id}
            disabled={isPending}
            onRemoved={onRemoved}
          />
          <span className="ms-auto system-xs-regular text-text-tertiary">
            {t(($) => $['editModal.createdAt'], { ns: 'appAnnotation' })}{' '}
            {item.created_at != null
              ? formatTime(
                  item.created_at,
                  t(($) => $.dateTimeFormat, { ns: 'appLog' }),
                )
              : '-'}
          </span>
        </DialogFooter>
      )}
    </>
  )
}
