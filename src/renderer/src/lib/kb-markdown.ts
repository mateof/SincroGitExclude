import { visit, SKIP } from 'unist-util-visit'
import { defaultSchema } from 'rehype-sanitize'
import type { Root, Text, PhrasingContent, Blockquote } from 'mdast'
import { CALLOUT_PATTERN, parseWikiInner } from '../../../shared/kb/wikilink'

const INLINE = /(!?)\[\[([^[\]\n]+?)\]\]|==([^=\n]+)==|%%[\s\S]*?%%|(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu

function wikiDisplay(inner: string): string {
  const { target, heading, alias } = parseWikiInner(inner)
  if (alias) return alias
  if (!target && heading) return heading
  return heading ? `${target} › ${heading}` : target
}

function splitText(value: string): PhrasingContent[] {
  const out: PhrasingContent[] = []
  let last = 0
  for (const match of value.matchAll(INLINE)) {
    const at = match.index ?? 0
    if (at > last) out.push({ type: 'text', value: value.slice(last, at) })
    if (match[2] !== undefined) {
      const inner = match[2]
      if (match[1] === '!') {
        out.push({ type: 'image', url: `kb-embed:${encodeURIComponent(inner)}`, alt: wikiDisplay(inner) })
      } else {
        out.push({ type: 'link', url: `kb-wiki:${encodeURIComponent(inner)}`, children: [{ type: 'text', value: wikiDisplay(inner) }] })
      }
    } else if (match[3] !== undefined) {
      out.push({ type: 'emphasis', data: { hName: 'mark' }, children: [{ type: 'text', value: match[3] }] })
    } else if (match[5] !== undefined) {
      if (match[4]) out.push({ type: 'text', value: match[4] })
      out.push({ type: 'link', url: `kb-tag:${encodeURIComponent(match[5])}`, children: [{ type: 'text', value: `#${match[5]}` }] })
    }
    last = at + match[0].length
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

export function remarkObsidian() {
  return (tree: Root): void => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      const first = node.children[0]
      if (!first || first.type !== 'paragraph') return
      const head = first.children[0]
      if (!head || head.type !== 'text') return
      const nl = head.value.indexOf('\n')
      const firstLine = nl >= 0 ? head.value.slice(0, nl) : head.value
      const match = firstLine.match(CALLOUT_PATTERN)
      if (!match) return
      head.value = nl >= 0 ? head.value.slice(nl + 1) : ''
      if (!head.value) first.children.shift()
      if (first.children[0]?.type === 'break') first.children.shift()
      if (first.children.length === 0) node.children.shift()
      node.data = {
        hProperties: {
          dataCallout: match[1].toLowerCase(),
          dataCalloutTitle: match[3] || '',
          dataCalloutFold: match[2] || ''
        }
      }
    })
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined || parent.type === 'link' || parent.type === 'linkReference') return
      const parts = splitText(node.value)
      if (parts.length === 1 && parts[0].type === 'text') return
      ;(parent.children as PhrasingContent[]).splice(index, 1, ...parts)
      return [SKIP, index + parts.length]
    })
  }
}

export const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), 'dataCallout', 'dataCalloutTitle', 'dataCalloutFold'],
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-[\w-]+$/]],
    span: [...(defaultSchema.attributes?.span ?? []), 'className']
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'kb-wiki', 'kb-tag'],
    src: [...(defaultSchema.protocols?.src ?? []), 'kb-embed']
  }
}

const SAFE_SCHEMES = /^(https?|mailto|kb-wiki|kb-embed|kb-tag):/i

export function kbUrlTransform(url: string): string {
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i)
  if (!scheme) return url
  return SAFE_SCHEMES.test(url) ? url : ''
}

export function textOf(children: unknown): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(textOf).join('')
  if (children && typeof children === 'object' && 'props' in (children as Record<string, unknown>)) {
    return textOf((children as { props: { children?: unknown } }).props.children)
  }
  return ''
}

export function decodeTarget(url: string, prefix: string): string {
  try {
    return decodeURIComponent(url.slice(prefix.length))
  } catch {
    return url.slice(prefix.length)
  }
}
