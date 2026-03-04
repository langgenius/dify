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
  // defaultRehypePlugins.sanitize is [rehypeSanitize, schema]
  const [sanitizePlugin, defaultSanitizeSchema] = defaultRehypePlugins.sanitize as [Pluggable, Record<string, unknown>]

  const tagNamesSet = new Set([
    ...((defaultSanitizeSchema.tagNames as string[]) ?? []),
    ...Object.keys(ALLOWED_TAGS),
  ])

  const customSchema = {
    ...defaultSanitizeSchema,
    tagNames: Array.from(tagNamesSet),
    attributes: {
      ...(defaultSanitizeSchema.attributes as Record<string, string[]>),
      ...ALLOWED_TAGS,
    },
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

export type ReactMarkdownWrapperProps = {
  latexContent: string
  customDisallowedElements?: string[]
  customComponents?: Components
  pluginInfo?: SimplePluginInfo
  rehypePlugins?: StreamdownProps['rehypePlugins']
  isAnimating?: boolean
  className?: string
}

const ReactMarkdownWrapper = (props: ReactMarkdownWrapperProps) => {
  const { customComponents, latexContent, pluginInfo, isAnimating, className } = props

  const remarkPlugins = useMemo(
    () => [
      [Array.isArray(defaultRemarkPlugins.gfm) ? defaultRemarkPlugins.gfm[0] : defaultRemarkPlugins.gfm, { singleTilde: false }] as Pluggable,
      RemarkBreaks,
    ],
    [],
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
      details: ThinkBlock as React.ComponentType,
      ...customComponents,
    }),
    [pluginInfo, customComponents],
  )

  const controls = useMemo(() => ({
    table: false,
  }), [])

  return (
    <Streamdown
      className={className}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      plugins={plugins}
      urlTransform={customUrlTransform}
      disallowedElements={disallowedElements}
      components={components}
      controls={controls}
      isAnimating={isAnimating}
    >
      {latexContent}
    </Streamdown>
  )
}

export default memo(ReactMarkdownWrapper)
