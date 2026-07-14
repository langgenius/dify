'use client'

import type { ComponentProps } from 'react'
import Link from '@/next/link'

const createDeploymentGuideHref = '/deployments/create'

type CreateDeploymentGuideLinkProps = Omit<ComponentProps<typeof Link>, 'href'>

export function CreateDeploymentGuideLink(props: CreateDeploymentGuideLinkProps) {
  return <Link {...props} href={createDeploymentGuideHref} />
}
