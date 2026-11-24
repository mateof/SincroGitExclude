import { spawn } from 'child_process'
import { execFileSync } from 'child_process'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { join } from 'path'

export interface GitHttpServer {
  origin: string
  seen: string[]
  close: () => Promise<void>
}

export async function startGitHttpServer(
  root: string,
  credential: { username: string; token: string } | null,
  redirectTo?: string
): Promise<GitHttpServer> {
  const backend = join(execFileSync('git', ['--exec-path'], { encoding: 'utf-8' }).trim(), 'git-http-backend')
  const seen: string[] = []
  const expected = credential ? `Basic ${Buffer.from(`${credential.username}:${credential.token}`).toString('base64')}` : null
  const server: Server = createServer((req, res) => {
    if (req.headers.authorization) seen.push(req.headers.authorization)
    if (redirectTo) {
      res.writeHead(302, { Location: `${redirectTo}${req.url}` }).end()
      return
    }
    if (expected && req.headers.authorization !== expected) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' }).end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const child = spawn(backend, [], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        REMOTE_USER: credential?.username ?? 'anonymous',
        REQUEST_METHOD: req.method ?? 'GET',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: (req.headers['content-encoding'] as string) ?? '',
        GIT_PROTOCOL: (req.headers['git-protocol'] as string) ?? ''
      }
    })
    req.pipe(child.stdin)
    const chunks: Buffer[] = []
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.on('close', () => {
      const raw = Buffer.concat(chunks)
      const split = raw.indexOf('\r\n\r\n')
      let status = 200
      for (const line of raw.subarray(0, split).toString().split('\r\n')) {
        const at = line.indexOf(':')
        const name = line.slice(0, at)
        const value = line.slice(at + 1).trim()
        if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0])
        else res.setHeader(name, value)
      }
      res.writeHead(status)
      res.end(raw.subarray(split + 4))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
