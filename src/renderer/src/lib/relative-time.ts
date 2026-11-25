export function relativeTime(iso: string | null, lang: string): string {
  if (!iso) return ''
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(lang === 'es' ? 'es' : 'en', { numeric: 'auto' })
  const size = Math.abs(seconds)
  if (size < 60) return rtf.format(seconds, 'second')
  if (size < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (size < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  return rtf.format(Math.round(seconds / 86400), 'day')
}

export function dateTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}
