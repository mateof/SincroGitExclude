import { normalize } from 'path'

export function normalizePath(p: string): string {
  return normalize(p).replace(/\\/g, '/')
}

export function toNativePath(p: string): string {
  return normalize(p)
}
