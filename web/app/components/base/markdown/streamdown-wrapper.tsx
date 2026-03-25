import type { ComponentType } from 'react'
import type { Components, StreamdownProps } from 'streamdown'
import { createMathPlugin } from '@streamdown/math'
import { memo, useMemo } from 'react'
import RemarkBreaks from 'remark-breaks'
import { defaultRehypePlugins, defaultRemarkPlugins, Streamdown } from 'streamdown'
import {
  AudioBlock,
  Img,
  Link,
  MarkdownButton,
  MarkdownForm,
  Paragraph,
  PluginImg,
  PluginParagraph,
  ThinkBlock,
  VideoBlock,
} from '@/app/components/base/markdown-blocks'
import { ENABLE_SINGLE_DOLLAR_LATEX } from '@/config'
import dynamic from '@/next/dynamic'
import { customUrlTransform } from './markdown-utils'
import 'katex/dist/katex.min.css'

type PluggableList = NonNullable<StreamdownProps['rehypePlugins']>
type Pluggable = PluggableList[number]

type AttributeDefinition = string | [string, ...(string | boolean | RegExp)[]]

type SanitizeSchema = {
  tagNames?: string[]
  attributes?: Record<string, AttributeDefinition[]>
  required?: Record<string, Record<string, unknown>>
  clobber?: string[]
  clobberPrefix?: string
  [key: string]: unknown
}

const CodeBlock = dynamic(() => import('@/app/components/base/markdown-blocks/code-block'), { ssr: false })

const mathPlugin = createMathPlugin({
  singleDollarTextMath: ENABLE_SINGLE_DOLLAR_LATEX,
})

/**
 * Allowed HTML tags and their permitted data attributes for rehype-sanitize.
 * Keys = tag names to allow; values = attribute names in **hast** property format
 * (camelCase, e.g. `dataThink` for `data-think`).
 *
 * Prefer explicit attribute lists over wildcards (e.g. `data*`) to
 * minimise the attack surface when LLM-generated content is rendered.
 */
const ALLOWED_TAGS: Record<string, string[]> = {
  button: ['dataVariant', 'dataSize', 'dataMessage', 'dataLink'],
  form: ['dataFormat'],
  input: ['type', 'name', 'value', 'placeholder', 'checked', 'dataTip', 'dataOptions'],
  textarea: ['name', 'placeholder', 'value'],
  label: ['htmlFor'],
  details: ['dataThink'],
  video: ['src'],
  audio: ['src'],
  source: ['src'],
  mark: [],
  sub: [],
  sup: [],
  kbd: [],
  // custom tags from human input node
  variable: ['dataPath'],
  section: ['dataName'],
}

/**
 * Build a rehype plugin list that includes the default raw → sanitize → harden
 * pipeline with `ALLOWED_TAGS` baked into the sanitize schema, plus any extra
 * plugins the caller provides.
 *
 * This sidesteps the streamdown `allowedTags` prop, which only takes effect
 * when `rehypePlugins` is the exact default reference (identity check).
 */
function buildRehypePlugins(extraPlugins?: PluggableList): PluggableList {
  const [sanitizePlugin, defaultSanitizeSchema]
    = defaultRehypePlugins.sanitize as [Pluggable, SanitizeSchema]

  const tagNamesSet = new Set([
    ...(defaultSanitizeSchema.tagNames ?? []),
    ...Object.keys(ALLOWED_TAGS),
  ])

  const mergedAttributes: Record<string, AttributeDefinition[]> = {
    ...(defaultSanitizeSchema.attributes ?? {}),
  }

  for (const tag of Object.keys(ALLOWED_TAGS)) {
    const existing = mergedAttributes[tag]
    if (existing) {
      // When we add an unrestricted attribute (bare string), remove any
      // existing restricted tuple for the same name.  hast-util-sanitize's
      // `findDefinition` returns the *first* match, so a restricted tuple
      // like `['type','checkbox']` would shadow our unrestricted `'type'`.
      const overrideNames = new Set(ALLOWED_TAGS[tag])
      const filtered = existing.filter((entry) => {
        const name = typeof entry === 'string' ? entry : entry[0]
        return !overrideNames.has(name as string)
      })
      mergedAttributes[tag] = [...filtered, ...ALLOWED_TAGS[tag]]
    }
    else {
      mergedAttributes[tag] = ALLOWED_TAGS[tag]
    }
  }

  // The default schema forces `input` to be `{disabled:true, type:'checkbox'}`
  // via `required`.  Drop that so form inputs keep their original attributes.
  const { input: _inputRequired, ...requiredRest }
    = (defaultSanitizeSchema.required ?? {})

  // `name` is in the default `clobber` list, which prefixes every `name` value
  // with `user-content-`.  Form fields need the original `name`, and our form
  // component validates names with `isSafeName()`, so remove it.
  const clobber = (defaultSanitizeSchema.clobber ?? []).filter(k => k !== 'name')

  const customSchema: SanitizeSchema = {
    ...defaultSanitizeSchema,
    tagNames: [...tagNamesSet],
    attributes: mergedAttributes,
    required: requiredRest,
    clobber,
  }

  return [
    defaultRehypePlugins.raw,
    ...(extraPlugins ?? []),
    [sanitizePlugin, customSchema] as Pluggable,
    defaultRehypePlugins.harden,
  ]
}

export type SimplePluginInfo = {
  pluginUniqueIdentifier: string
  pluginId: string
}

export type StreamdownWrapperProps = {
  latexContent: string
  customDisallowedElements?: string[]
  customComponents?: Components
  pluginInfo?: SimplePluginInfo
  remarkPlugins?: StreamdownProps['remarkPlugins']
  rehypePlugins?: StreamdownProps['rehypePlugins']
  isAnimating?: boolean
  className?: string
  mode?: StreamdownProps['mode']
}

const StreamdownWrapper = (props: StreamdownWrapperProps) => {
  const {
    customComponents,
    latexContent,
    pluginInfo,
    isAnimating,
    className,
    mode = 'streaming',
  } = props

  const remarkPlugins = useMemo(
    () => [
      [Array.isArray(defaultRemarkPlugins.gfm) ? defaultRemarkPlugins.gfm[0] : defaultRemarkPlugins.gfm, { singleTilde: false }] as Pluggable,
      RemarkBreaks,
      ...(props.remarkPlugins ?? []),
    ],
    [props.remarkPlugins],
  )

  const rehypePlugins = useMemo(
    () => buildRehypePlugins(props.rehypePlugins ?? undefined),
    [props.rehypePlugins],
  )

  const plugins = useMemo(
    () => ({
      math: mathPlugin,
    }),
    [],
  )

  const disallowedElements = useMemo(
    () => ['iframe', 'head', 'html', 'meta', 'link', 'style', 'body', ...(props.customDisallowedElements || [])],
    [props.customDisallowedElements],
  )

  const components: Components = useMemo(
    () => ({
      code: CodeBlock,
      img: imgProps => pluginInfo ? <PluginImg src={String(imgProps.src ?? '')} pluginInfo={pluginInfo} /> : <Img src={String(imgProps.src ?? '')} />,
      video: VideoBlock,
      audio: AudioBlock,
      a: Link,
      p: pProps => pluginInfo ? <PluginParagraph {...pProps} pluginInfo={pluginInfo} /> : <Paragraph {...pProps} />,
      button: MarkdownButton,
      form: MarkdownForm as ComponentType,
      details: ThinkBlock as ComponentType,
      ...customComponents,
    }),
    [pluginInfo, customComponents],
  )

  return (
    <Streamdown
      className={className}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      plugins={plugins}
      urlTransform={customUrlTransform}
      disallowedElements={disallowedElements}
      components={components}
      isAnimating={isAnimating}
      mode={mode}
    >
      {latexContent}
    </Streamdown>
  )
}

export default memo(StreamdownWrapper)
