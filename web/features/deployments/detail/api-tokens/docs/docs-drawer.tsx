'use client'

import type { App } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import TemplateWorkflowEn from '@/app/components/develop/template/template_workflow.en.mdx'
import TemplateWorkflowJa from '@/app/components/develop/template/template_workflow.ja.mdx'
import TemplateWorkflowZh from '@/app/components/develop/template/template_workflow.zh.mdx'
import { useLocale } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { getDocLanguage } from '@/i18n-config/language'
import { AppModeEnum, Theme } from '@/types/app'
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'

type PromptVariable = { key: string, name: string }
type WorkflowApiDocAppDetail = Pick<App, 'id' | 'mode' | 'api_base_url'>

type WorkflowDocTemplateProps = {
  appDetail: WorkflowApiDocAppDetail
  variables: PromptVariable[]
  inputs: Record<string, string>
}

const EMPTY_VARIABLES: PromptVariable[] = []
const EMPTY_INPUTS: Record<string, string> = {}

function WorkflowDocTemplate({ docLanguage, appDetail, variables, inputs }: WorkflowDocTemplateProps & {
  docLanguage: string
}) {
  if (docLanguage === 'zh') {
    return (
      <TemplateWorkflowZh
        appDetail={appDetail}
        variables={variables}
        inputs={inputs}
      />
    )
  }
  if (docLanguage === 'ja') {
    return (
      <TemplateWorkflowJa
        appDetail={appDetail}
        variables={variables}
        inputs={inputs}
      />
    )
  }

  return (
    <TemplateWorkflowEn
      appDetail={appDetail}
      variables={variables}
      inputs={inputs}
    />
  )
}

export function DeveloperApiDocsDrawer({
  open,
  apiBaseUrl,
  onOpenChange,
}: {
  open: boolean
  apiBaseUrl: string
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const locale = useLocale()
  const { theme } = useTheme()
  const docLanguage = getDocLanguage(locale)

  if (!appInstanceId)
    return null

  const appDetail: WorkflowApiDocAppDetail = {
    id: appInstanceId,
    mode: AppModeEnum.WORKFLOW,
    api_base_url: apiBaseUrl,
  }

  return (
    <Drawer
      open={open}
      modal
      swipeDirection="right"
      onOpenChange={onOpenChange}
    >
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-[840px] data-[swipe-direction=right]:max-w-[calc(100vw-1rem)] data-[swipe-direction=right]:rounded-xl data-[swipe-direction=right]:border-[0.5px]">
            <DrawerCloseButton
              aria-label={t('access.api.docsClose')}
              className="absolute top-4 right-5 size-6 rounded-md"
            />
            <DrawerContent className="flex min-h-0 flex-1 flex-col bg-components-panel-bg p-0 pb-0">
              <div className="shrink-0 border-b border-divider-subtle px-6 py-5 pr-14">
                <DrawerTitle className="title-xl-semi-bold text-text-primary">
                  {t('access.api.docsTitle')}
                </DrawerTitle>
                <DrawerDescription className="mt-1 system-sm-regular text-text-tertiary">
                  {t('access.api.docsDescription')}
                </DrawerDescription>
              </div>

              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-5">
                <article className={cn('prose max-w-none', theme === Theme.dark && 'prose-invert')}>
                  <WorkflowDocTemplate
                    docLanguage={docLanguage}
                    appDetail={appDetail}
                    variables={EMPTY_VARIABLES}
                    inputs={EMPTY_INPUTS}
                  />
                </article>
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
