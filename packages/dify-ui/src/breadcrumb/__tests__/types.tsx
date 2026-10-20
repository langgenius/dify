import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@langgenius/dify-ui/breadcrumb'

export function breadcrumbTypeContracts() {
  const labelled = <Breadcrumb aria-label="Page path" />
  const referenced = <Breadcrumb aria-labelledby="path-heading" />
  const link = <BreadcrumbLink render={<a href="/projects" />} aria-current="page" />

  // @ts-expect-error A navigation name must be supplied by the consumer.
  const unnamed = <Breadcrumb />
  // @ts-expect-error Choose one accessible naming mechanism.
  const duplicateName = <Breadcrumb aria-label="Path" aria-labelledby="heading" />
  // @ts-expect-error Structural parts do not expose render.
  const rootRender = <Breadcrumb aria-label="Path" render={<div />} />
  // @ts-expect-error List semantics are fixed.
  const listRender = <BreadcrumbList render={<div />} />
  // @ts-expect-error Item semantics are fixed.
  const itemRender = <BreadcrumbItem render={<div />} />
  // @ts-expect-error Use BreadcrumbLink for an interactive current page.
  const pageRender = <BreadcrumbPage render={<a href="/projects" />} />
  // @ts-expect-error Customize decorative content through children.
  const separatorRender = <BreadcrumbSeparator render={<span />} />

  return {
    labelled,
    referenced,
    link,
    unnamed,
    duplicateName,
    rootRender,
    listRender,
    itemRender,
    pageRender,
    separatorRender,
  }
}
