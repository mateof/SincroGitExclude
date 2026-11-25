export interface WikiTarget {
  target: string
  heading: string | null
  block: string | null
  alias: string | null
}

export const WIKILINK_PATTERN = /(!?)\[\[([^[\]\n]+?)\]\]/g

export function parseWikiInner(inner: string): WikiTarget {
  const unescaped = inner.replace(/\\\|/g, '|')
  const pipe = unescaped.indexOf('|')
  const ref = (pipe >= 0 ? unescaped.slice(0, pipe) : unescaped).trim()
  const alias = pipe >= 0 ? unescaped.slice(pipe + 1).trim() || null : null
  const hash = ref.indexOf('#')
  const target = (hash >= 0 ? ref.slice(0, hash) : ref).trim()
  let heading: string | null = null
  let block: string | null = null
  if (hash >= 0) {
    const anchor = ref.slice(hash + 1).trim()
    if (anchor.startsWith('^')) block = anchor.slice(1) || null
    else heading = anchor.replace(/#/g, ' ').replace(/\s+/g, ' ').trim() || null
  }
  return { target, heading, block, alias }
}

export function foldText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
}

export function headingSlug(text: string): string {
  return foldText(text)
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

export const TAG_PATTERN = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu

export const CALLOUT_PATTERN = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/

export const NOTE_EXTENSIONS = ['.md']

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export function isNotePath(path: string): boolean {
  return NOTE_EXTENSIONS.includes(extensionOf(path))
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.includes(extensionOf(path))
}

export function basenameNoExt(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return isNotePath(name) ? name.slice(0, -extensionOf(name).length) : name
}
