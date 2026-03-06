import type { ComponentType } from 'react'
import type { Components, StreamdownProps } from 'streamdown'
import { createMathPlugin } from '@streamdown/math'
import dynamic from 'next/dynamic'
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
import { customUrlTransform } from './markdown-utils'
import 'katex/dist/katex.min.css'

type PluggableList = NonNullable<StreamdownProps['rehypePlugins']>
type Pluggable = PluggableList[number]

type SanitizeSchema = {
  tagNames?: string[]
  attributes?: Record<string, string[]>
  [key: string]: unknown
}

const CodeBlock = dynamic(() => import('@/app/components/base/markdown-blocks/code-block'), { ssr: false })

const mathPlugin = createMathPlugin({
  singleDollarTextMath: ENABLE_SINGLE_DOLLAR_LATEX,
})

/**
 * Allowed HTML tags and their permitted data attributes for rehype-sanitize.
 * Keys = tag names to allow; values = attribute names in **hast** property format
 * (camelCase, e.g. `dataThink` for `data-think`, or the wildcard `data*`).
 */
const ALLOWED_TAGS: Record<string, string[]> = {
  button: ['data*'],
  form: ['data*'],
  details: ['dataThink'],
  video: ['src', 'controls', 'width', 'height', 'data*'],
  audio: ['src', 'controls', 'data*'],
  source: ['src'],
  mark: [],
  sub: [],
  sup: [],
  kbd: [],
  // custom tags from human input node
  variable: ['data*'],
  section: ['data*'],
  // ... existing tags ...
  withiconlist: ['className', 'mt'],
  withiconitem: ['icon'],
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

  const mergedAttributes: Record<string, string[]> = {
    ...(defaultSanitizeSchema.attributes ?? {}),
  }
  for (const tag of Object.keys(ALLOWED_TAGS)) {
    mergedAttributes[tag] = mergedAttributes[tag]
      ? Array.from(new Set([...mergedAttributes[tag], ...ALLOWED_TAGS[tag]]))
      : ALLOWED_TAGS[tag]
  }

  const customSchema: SanitizeSchema = {
    ...defaultSanitizeSchema,
    tagNames: Array.from(tagNamesSet),
    attributes: mergedAttributes,
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
      form: MarkdownForm,
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
