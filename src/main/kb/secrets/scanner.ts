export interface SecretFinding {
  rule: string
  line: number
  preview: string
}

interface Rule {
  name: string
  pattern: RegExp
}

const RULES: Rule[] = [
  { name: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'github-fine-grained-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'openai-key', pattern: /\bsk-(?:proj-|svcacct-)?(?!ant-)[A-Za-z0-9_-]{32,}/ },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'stripe-live-key', pattern: /\b(?:sk|rk)_live_[0-9a-zA-Z]{24,}\b/ },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'sincrogitexclude-token', pattern: /\bsge_[A-Za-z0-9_-]{32}\b/ },
  { name: 'bearer-token', pattern: /\bBearer\s+([A-Za-z0-9._~+/=-]{24,})/ },
  {
    name: 'assigned-secret',
    pattern: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*["']?\s*[:=]\s*["']?([^\s"'`,;]{12,})/i
  }
]

const PLACEHOLDER = /^(?:\*+|x{4,}|<[^>]*>|\$\{[^}]*\}|\$\(|\$[A-Z_]+|\{\{[^}]*\}\}|your[_-]|changeme|example|redacted|\.{3,}|…)/i

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return false
  return PLACEHOLDER.test(value) || /^[a-z_]+$/i.test(value)
}

function mask(text: string): string {
  if (text.length <= 10) return '•'.repeat(text.length)
  return `${text.slice(0, 6)}${'•'.repeat(Math.min(12, text.length - 8))}${text.slice(-2)}`
}

export function scanText(text: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('sge-kb:allow-secret')) continue
    for (const rule of RULES) {
      const match = line.match(rule.pattern)
      if (!match) continue
      if (match[1] !== undefined && isPlaceholder(match[1])) continue
      findings.push({ rule: rule.name, line: i + 1, preview: mask(match[0]) })
      break
    }
  }
  return findings
}

export function isScannable(path: string, size: number): boolean {
  if (size > 2 * 1024 * 1024) return false
  return /\.(md|markdown|txt|json|ya?ml|toml|ini|env|conf|cfg|canvas|csv|xml|html?|sh|ps1|js|ts|py)$/i.test(path) || !/\.[a-z0-9]+$/i.test(path)
}
