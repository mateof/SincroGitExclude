import { compareVersions, parseVersion } from '../../shared/update-channels'

export const GITHUB_REPO = 'mateof/SincroGitExclude'
const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024

export interface GithubRelease {
  tag_name?: string
  draft?: boolean
  assets?: Array<{ name?: string; size?: number; digest?: string | null; browser_download_url?: string }>
}

export interface UpdateAsset {
  version: string
  url: string
  size: number
  sha256: string
}

export function releaseApiUrl(version: string): string {
  return `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/v${version}`
}

export function assertNewerVersion(current: string, version: string): void {
  if (!parseVersion(version) || version.startsWith('v') || version.includes('+')) {
    throw new Error('Invalid version')
  }
  if (compareVersions(current, version) >= 0) {
    throw new Error(`Version ${version} is not newer than the installed one (${current})`)
  }
}

export function selectMacAsset(release: GithubRelease, version: string, arch: string): UpdateAsset {
  const tag = `v${version}`
  if (release.draft || release.tag_name !== tag) throw new Error(`The release ${tag} is not published`)
  const name = `sincrogitexclude-${version}-${arch}.dmg`
  const asset = release.assets?.find((a) => a.name === name)
  if (!asset) throw new Error(`The release ${tag} has no macOS build for ${arch}`)
  const url = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${name}`
  if (asset.browser_download_url !== url) throw new Error('Unexpected download address')
  const digest = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '')
  if (!digest) throw new Error('The release does not publish the SHA-256 of the file')
  const size = asset.size ?? 0
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_ASSET_BYTES) throw new Error('Unexpected file size')
  return { version, url, size, sha256: digest[1] }
}
