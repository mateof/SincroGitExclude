import { spawn } from 'child_process'
import { dirname, join } from 'path'

const SWAP_SCRIPT = [
  'pid="$1"; target="$2"; staged="$3"; stage="$4"; opener="$5"; tries="$6"; failure="$7"',
  'failed() { echo "$1" > "$failure"; }',
  'n=0',
  'while kill -0 "$pid" 2>/dev/null; do',
  '  n=$((n + 1))',
  '  if [ "$n" -gt "$tries" ]; then rm -rf "$stage"; exit 2; fi',
  '  sleep 0.2',
  'done',
  'previous="$stage/previous.app"',
  'if ! mv "$target" "$previous"; then failed 3; "$opener" "$target"; rm -rf "$stage"; exit 3; fi',
  'if ! mv "$staged" "$target"; then',
  '  failed 4',
  '  if mv "$previous" "$target"; then rm -rf "$stage"; fi',
  '  "$opener" "$target"',
  '  exit 4',
  'fi',
  'if "$opener" "$target"; then rm -rf "$stage"; exit 0; fi',
  'failed 5',
  'if mv "$target" "$stage/failed.app" && mv "$previous" "$target"; then rm -rf "$stage"; fi',
  '"$opener" "$target"',
  'exit 5'
].join('\n')

export function swapArguments(input: {
  pid: number
  target: string
  staged: string
  failureFile: string
  opener?: string
  tries?: number
}): string[] {
  return [
    '-c',
    SWAP_SCRIPT,
    'sge-update',
    String(input.pid),
    input.target,
    input.staged,
    dirname(input.staged),
    input.opener ?? '/usr/bin/open',
    String(input.tries ?? 300),
    input.failureFile
  ]
}

export function spawnSwap(input: { pid: number; target: string; staged: string; failureFile: string }): void {
  const child = spawn('/bin/sh', swapArguments(input), {
    cwd: '/',
    detached: true,
    stdio: 'ignore',
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? join('/', 'tmp') }
  })
  child.unref()
}
