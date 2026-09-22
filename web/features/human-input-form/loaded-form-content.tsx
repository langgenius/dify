import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import type { HumanInputFormDefinition } from './types'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { UnsubmittedHumanInputContentProps } from '@/app/components/base/chat/chat/answer/human-input-content/type'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { Button } from '@langgenius/dify-ui/button'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import ExpirationTime from '@/app/components/base/chat/chat/answer/human-input-content/expiration-time'
import HumanInputFieldRenderer from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import Tips from '@/app/components/base/chat/chat/answer/human-input-content/tips'
import {
  getButtonStyle,
  getProcessedHumanInputFormInputs,
  getRenderedFormInputs,
  hasInvalidRequiredHumanInput,
  hasInvalidSelectOrFileInput,
  initializeInputs,
  splitByOutputVar,
} from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import { Markdown } from '@/app/components/base/markdown'
import { isParagraphFormInput } from '@/app/components/workflow/nodes/human-input/types'
import BrandingFooter from './branding-footer'

type LoadedFormContentProps = {
  definition: HumanInputFormDefinition
  isSubmitting: boolean
  actionsDisabled?: boolean
  verificationContent?: ReactNode
  onSubmit: (inputs: Record<string, unknown>, actionID: string) => void | Promise<void>
}

type FormLayout = 'workflow' | 'standalone'
type MarkdownNode = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: MarkdownNode[]
  value?: string
}

// Use Markdown's existing extension points; the wrapper belongs only to this form.
const rehypeFormLayout = () => (tree: MarkdownNode) => {
  const children = (tree.children || []).filter(
    (node) => node.type !== 'text' || node.value?.trim(),
  )
  const blocks: MarkdownNode[] = []
  for (let index = 0; index < children.length; index++) {
    const node = children[index]!
    const next = children[index + 1]
    if (node.tagName === 'p' && (next?.tagName === 'ul' || next?.tagName === 'ol')) {
      blocks.push({
        type: 'element',
        tagName: 'section',
        properties: { dataName: 'human-input-list' },
        children: [node, next],
      })
      index++
    } else {
      blocks.push(node)
    }
  }
  tree.children = [
    {
      type: 'element',
      tagName: 'section',
      properties: { dataName: 'human-input-layout' },
      children: blocks,
    },
  ]
}
const formMarkdownPlugins = [rehypeFormLayout]

const FormImage = ({ src, alt, compact }: { src: string; alt: string; compact: boolean }) => {
  const { t } = useTranslation()
  const [preview, setPreview] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!src || failed) return null

  return (
    <>
      <button
        type="button"
        aria-label={alt || t(($) => $['operation.view'], { ns: 'common' })}
        className="block max-w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-input-border-active"
        style={{ width: compact ? 240 : '100%' }}
        onClick={() => setPreview(true)}
      >
        <img
          src={src}
          alt={alt}
          style={{
            boxSizing: 'border-box',
            border: 0,
            width: '100%',
            height: compact ? 120 : 'auto',
            margin: 0,
            maxHeight: 'none',
            objectFit: 'cover',
            outline: '2px solid var(--color-effects-image-frame)',
            outlineOffset: -2,
            boxShadow: 'var(--shadow-xs)',
          }}
          onError={() => setFailed(true)}
        />
      </button>
      {preview && <ImagePreview url={src} title={alt} onCancel={() => setPreview(false)} />}
    </>
  )
}

const createFormMarkdownComponents = (compact: boolean): MarkdownProps['customComponents'] => {
  const gap = compact ? 8 : 12
  const heading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
    function FormHeading({
      children,
      node: _node,
      ...props
    }: ComponentPropsWithoutRef<'h1'> & { node?: unknown }) {
      return (
        <Tag
          {...props}
          style={{
            ...props.style,
            margin: 0,
            paddingTop: gap,
            lineHeight: 1.2,
            letterSpacing: 'normal',
            fontWeight: 600,
          }}
        >
          {children}
        </Tag>
      )
    }

  const components: NonNullable<MarkdownProps['customComponents']> = {}
  components.section = ({ node, children, ...props }) =>
    node?.properties?.dataName === 'human-input-layout' ? (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap,
          fontSize: compact ? 14 : 15,
          lineHeight: compact ? '20px' : '24px',
          letterSpacing: '-0.005em',
        }}
      >
        {children}
      </div>
    ) : node?.properties?.dataName === 'human-input-list' ? (
      <div>{children}</div>
    ) : (
      <section {...props}>{children}</section>
    )
  components.h1 = heading('h1')
  components.h2 = heading('h2')
  components.h3 = heading('h3')
  components.h4 = heading('h4')
  components.h5 = heading('h5')
  components.h6 = heading('h6')
  components.p = ({ node, children, ...props }) =>
    node?.children.some((child) => child.type === 'element' && child.tagName === 'img') ? (
      <div {...props} style={{ ...props.style, margin: 0 }}>
        {children}
      </div>
    ) : (
      <p {...props} style={{ ...props.style, margin: 0 }}>
        {children}
      </p>
    )
  components.ul = ({ children, node: _node, ...props }) => (
    <ul
      {...props}
      style={{ ...props.style, margin: 0, paddingLeft: '1.5em', listStylePosition: 'outside' }}
    >
      {children}
    </ul>
  )
  components.ol = ({ children, node: _node, ...props }) => (
    <ol
      {...props}
      style={{ ...props.style, margin: 0, paddingLeft: '1.5em', listStylePosition: 'outside' }}
    >
      {children}
    </ol>
  )
  components.li = ({ children, node: _node, ...props }) => (
    <li {...props} style={{ ...props.style, paddingBlock: 0 }}>
      {children}
    </li>
  )
  components.img = ({ src, alt }) => (
    <FormImage src={typeof src === 'string' ? src : ''} alt={alt || ''} compact={compact} />
  )
  return components
}
const formMarkdownComponents = {
  workflow: createFormMarkdownComponents(true),
  standalone: createFormMarkdownComponents(false),
}

type FormBodyProps = LoadedFormContentProps & { layout?: FormLayout }

const FormBody = ({
  definition,
  isSubmitting,
  actionsDisabled = false,
  verificationContent,
  onSubmit,
  layout = 'standalone',
}: FormBodyProps) => {
  const renderedFormInputs = getRenderedFormInputs(definition.inputs, definition.formContent)
  const [inputs, setInputs] = useState<Record<string, HumanInputFieldValue>>(() =>
    initializeInputs(renderedFormInputs, definition.resolvedDefaultValues),
  )
  const [pending, setPending] = useState(false)
  const compact = layout === 'workflow'
  const contentList = useMemo(() => {
    const contentCounts = new Map<string, number>()
    return splitByOutputVar(definition.formContent).map((content) => {
      const occurrence = (contentCounts.get(content) || 0) + 1
      contentCounts.set(content, occurrence)
      return { key: `${content}-${occurrence}`, content }
    })
  }, [definition.formContent])

  const changeInput = (name: string, value: HumanInputFieldValue) => {
    setInputs((prev) => ({ ...prev, [name]: value }))
  }
  const submit = async (actionID: string) => {
    setPending(true)
    try {
      await onSubmit(
        getProcessedHumanInputFormInputs(
          compact ? renderedFormInputs : definition.inputs,
          inputs,
        ) || {},
        actionID,
      )
    } finally {
      setPending(false)
    }
  }
  const hasInvalidInput = compact ? hasInvalidSelectOrFileInput : hasInvalidRequiredHumanInput
  const disabled =
    actionsDisabled || isSubmitting || pending || hasInvalidInput(renderedFormInputs, inputs)

  return (
    <div className={compact ? 'flex flex-col gap-2' : 'flex flex-col gap-3'}>
      {contentList.map(({ key, content }) => {
        const match = /\{\{#\$output\.([^#]+)#\}\}/.exec(content)
        if (!match) {
          return (
            <Markdown
              key={key}
              content={content}
              mode="static"
              rehypePlugins={formMarkdownPlugins}
              customComponents={formMarkdownComponents[layout]}
            />
          )
        }
        const field = definition.inputs.find((item) => item.output_variable_name === match[1])
        if (!field) return null
        const value = inputs[field.output_variable_name]
        return isParagraphFormInput(field) ? (
          <Textarea
            key={key}
            aria-label={field.output_variable_name}
            data-testid="content-item-textarea"
            size={compact ? 'medium' : 'large'}
            className={
              compact ? 'block h-20' : 'block h-28 text-[15px] leading-6 tracking-[-0.005em]'
            }
            value={typeof value === 'string' ? value : ''}
            onValueChange={(nextValue) => changeInput(field.output_variable_name, nextValue)}
          />
        ) : (
          <HumanInputFieldRenderer
            key={key}
            field={field}
            value={value}
            onChange={(nextValue) => changeInput(field.output_variable_name, nextValue)}
          />
        )
      })}
      {verificationContent}
      <div className="flex flex-wrap gap-1 py-1">
        {definition.actions.map((action) => (
          <Button
            key={action.id}
            size={compact ? 'small' : 'medium'}
            disabled={disabled}
            variant={getButtonStyle(action.button_style)}
            onClick={() => submit(action.id)}
          >
            {action.title}
          </Button>
        ))}
      </div>
    </div>
  )
}

export const WorkflowHumanInputForm = ({
  formData,
  showEmailTip = false,
  isEmailDebugMode = false,
  showDebugModeTip = false,
  onSubmit,
}: UnsubmittedHumanInputContentProps) => (
  <div>
    <FormBody
      definition={{
        formContent: formData.form_content,
        inputs: formData.inputs,
        resolvedDefaultValues: formData.resolved_default_values || {},
        actions: formData.actions,
        expirationTime: formData.expiration_time || 0,
      }}
      layout="workflow"
      isSubmitting={false}
      actionsDisabled={!formData.form_token}
      onSubmit={async (inputs, action) => {
        if (formData.form_token) await onSubmit?.(formData.form_token, { inputs, action })
      }}
    />
    {(showEmailTip || showDebugModeTip) && (
      <Tips
        showEmailTip={showEmailTip}
        isEmailDebugMode={isEmailDebugMode}
        showDebugModeTip={showDebugModeTip}
      />
    )}
    {typeof formData.expiration_time === 'number' && (
      <ExpirationTime expirationTime={formData.expiration_time * 1000} />
    )}
  </div>
)

const LoadedFormContent = ({
  definition,
  isSubmitting,
  actionsDisabled = false,
  verificationContent,
  onSubmit,
}: LoadedFormContentProps) => {
  const branding = definition.branding
  const removeWebappBrand = branding?.customConfig?.remove_webapp_brand === true
  const replaceWebappLogo =
    typeof branding?.customConfig?.replace_webapp_logo === 'string'
      ? branding.customConfig.replace_webapp_logo
      : null

  return (
    <div className="size-full [scrollbar-gutter:stable_both-edges] overflow-y-auto">
      <div className="mx-auto w-full max-w-180 px-4 py-4 sm:px-6">
        {branding && (
          <div className="flex w-full items-center gap-3 py-3">
            <AppIcon
              size="small"
              iconType={branding.site.icon_type}
              icon={branding.site.icon}
              background={branding.site.icon_background}
              imageUrl={branding.site.icon_url}
            />
            <div className="grow system-xl-semibold text-text-primary">{branding.site.title}</div>
          </div>
        )}
        <div className="relative rounded-[20px] bg-chat-bubble-bg p-4 shadow-lg backdrop-blur-xs before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border-t before:border-divider-subtle">
          <div className="flex flex-col gap-3 px-2 py-1">
            <FormBody
              definition={definition}
              isSubmitting={isSubmitting}
              actionsDisabled={actionsDisabled}
              verificationContent={verificationContent}
              onSubmit={onSubmit}
            />
            <div>
              <div className="[&_.i-ri-time-line]:hidden">
                <ExpirationTime expirationTime={definition.expirationTime * 1000} />
              </div>
            </div>
          </div>
        </div>
        <BrandingFooter
          removeWebappBrand={removeWebappBrand}
          replaceWebappLogo={replaceWebappLogo}
        />
      </div>
    </div>
  )
}

export default LoadedFormContent
