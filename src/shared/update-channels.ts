/**
 * Update channels and semver precedence, shared by the update checker.
 *
 * Channels are ordered from most to least conservative and each one also
 * includes the releases above it: `beta` sees stable + beta, `dev` sees
 * everything. Prereleases are published by .github/workflows/prerelease.yml,
 * which tags them `v<base>-dev.<n>` / `v<base>-beta.<n>`.
 *
 * Ordering is plain semver, so for the same base version `1.20.0-dev.3` ranks
 * above `1.20.0-beta.1` (prerelease identifiers compare alphabetically). That
 * is what the dev channel wants — the newest dev build — and both still rank
 * below the stable `1.20.0`.
 */
export const CHANNELS = ['stable', 'beta', 'dev'] as const
export type Channel = (typeof CHANNELS)[number]

export interface ParsedVersion {
  numbers: number[]
  prerelease: string[]
}

export function parseVersion(version: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version.trim()
  )
  if (!match) return null
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : []
  }
}

/** The channel a version belongs to, read from its semver prerelease part. */
export function channelOf(version: string): Channel {
  const parsed = parseVersion(version)
  if (!parsed || parsed.prerelease.length === 0) return 'stable'
  const pre = parsed.prerelease.join('.').toLowerCase()
  if (pre.includes('beta') || pre.includes('rc')) return 'beta'
  return 'dev'
}

/** Channels visible from a given channel, most conservative first. */
export function visibleFrom(channel: Channel): Channel[] {
  return CHANNELS.slice(0, CHANNELS.indexOf(channel) + 1)
}

export function isChannel(value: string | null): value is Channel {
  return value !== null && (CHANNELS as readonly string[]).includes(value)
}

/**
 * Semver precedence: numeric parts first, then the prerelease part — a version
 * without one outranks the same version with one (1.21.0 > 1.21.0-dev.4), and
 * numeric identifiers compare as numbers (dev.10 > dev.9). Unparseable versions
 * compare as equal so a stray tag never looks like an update.
 */
export function compareVersions(current: string, latest: string): number {
  const a = parseVersion(current)
  const b = parseVersion(latest)
  if (!a || !b) return 0

  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] < b.numbers[i] ? -1 : 1
  }

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1

  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const av = a.prerelease[i]
    const bv = b.prerelease[i]
    if (av === undefined) return -1
    if (bv === undefined) return 1
    if (av === bv) continue
    const aNum = /^\d+$/.test(av)
    const bNum = /^\d+$/.test(bv)
    if (aNum && bNum) return Number(av) < Number(bv) ? -1 : 1
    if (aNum !== bNum) return aNum ? -1 : 1 // numeric identifiers rank lower
    return av < bv ? -1 : 1
  }
  return 0
}

/** Newest release visible from `channel`, or null when the list has none. */
export function pickRelease<T extends { tag_name: string; draft?: boolean }>(
  releases: T[],
  channel: Channel
): T | null {
  const allowed = visibleFrom(channel)
  return (
    releases
      .filter((r) => !r.draft && parseVersion(r.tag_name) !== null)
      .filter((r) => allowed.includes(channelOf(r.tag_name)))
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0] ?? null
  )
}
