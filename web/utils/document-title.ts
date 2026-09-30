import type { BrandingModel } from '@dify/contracts/api/console/system-features/types.gen'

const DEFAULT_APPLICATION_TITLE = 'Dify'

export const getApplicationTitle = (
  branding?: Pick<BrandingModel, 'application_title' | 'enabled'>,
) =>
  branding?.enabled && branding.application_title
    ? branding.application_title
    : DEFAULT_APPLICATION_TITLE

export const formatDocumentTitle = (title: string, applicationTitle: string) =>
  title ? `${title} - ${applicationTitle}` : applicationTitle
