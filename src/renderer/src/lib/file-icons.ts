import type { LucideIcon } from 'lucide-react'
import {
  FileText,
  FileCode2,
  FileTerminal,
  FileImage,
  FileAudio,
  FileVideo,
  FileArchive,
  FileCog,
  FileKey,
  FileLock,
  FileCheck,
  FileSpreadsheet,
  FileType,
  Database,
  Terminal,
  Globe,
  Braces,
  Hash,
  BookOpen,
  Scroll,
  Coffee,
  Palette,
  Image,
  Container,
  FlaskConical,
  Scale,
  Wrench,
  Cloud,
  Rocket,
  Box,
  Bug,
  Server,
  Hexagon,
  PenTool,
  Network,
  ShieldCheck,
  Package
} from 'lucide-react'

export interface FileIconInfo {
  icon: LucideIcon
  color: string
}

// Level 1: Exact filename matches (case-insensitive)
const FILENAME_MAP: Record<string, FileIconInfo> = {
  // Docker
  'dockerfile': { icon: Container, color: '#2496ED' },
  'dockerfile.dev': { icon: Container, color: '#2496ED' },
  'dockerfile.prod': { icon: Container, color: '#2496ED' },
  'dockerfile.test': { icon: Container, color: '#2496ED' },
  'docker-compose.yml': { icon: Container, color: '#2496ED' },
  'docker-compose.yaml': { icon: Container, color: '#2496ED' },
  '.dockerignore': { icon: Container, color: '#2496ED' },

  // Node / npm / bun
  'package.json': { icon: Braces, color: '#CB3837' },
  'package-lock.json': { icon: FileLock, color: '#CB3837' },
  'yarn.lock': { icon: FileLock, color: '#2C8EBB' },
  'pnpm-lock.yaml': { icon: FileLock, color: '#F69220' },
  'pnpm-workspace.yaml': { icon: FileCog, color: '#F69220' },
  'bun.lock': { icon: FileLock, color: '#FBF0DF' },
  'bun.lockb': { icon: FileLock, color: '#FBF0DF' },
  '.npmrc': { icon: FileCog, color: '#CB3837' },
  '.npmignore': { icon: FileCog, color: '#CB3837' },
  '.yarnrc': { icon: FileCog, color: '#2C8EBB' },
  '.yarnrc.yml': { icon: FileCog, color: '#2C8EBB' },
  '.yarnclean': { icon: FileCog, color: '#2C8EBB' },

  // Version managers
  '.nvmrc': { icon: FileCog, color: '#3C873A' },
  '.node-version': { icon: FileCog, color: '#3C873A' },
  '.tool-versions': { icon: Wrench, color: '#6B4FBB' },
  '.python-version': { icon: FileCog, color: '#3776AB' },
  '.ruby-version': { icon: FileCog, color: '#CC342D' },
  '.php-version': { icon: FileCog, color: '#4F5D95' },
  '.java-version': { icon: FileCog, color: '#B07219' },
  '.rust-toolchain': { icon: FileCog, color: '#DEA584' },
  '.rust-toolchain.toml': { icon: FileCog, color: '#DEA584' },
  '.go-version': { icon: FileCog, color: '#00ADD8' },

  // TypeScript
  'tsconfig.json': { icon: Braces, color: '#3178C6' },
  'tsconfig.node.json': { icon: Braces, color: '#3178C6' },
  'tsconfig.app.json': { icon: Braces, color: '#3178C6' },
  'tsconfig.build.json': { icon: Braces, color: '#3178C6' },

  // Git
  '.gitignore': { icon: FileCog, color: '#F05032' },
  '.gitattributes': { icon: FileCog, color: '#F05032' },
  '.gitmodules': { icon: FileCog, color: '#F05032' },
  '.gitconfig': { icon: FileCog, color: '#F05032' },
  '.gitkeep': { icon: FileCog, color: '#F05032' },
  '.gitmessage': { icon: FileCog, color: '#F05032' },
  '.git-blame-ignore-revs': { icon: FileCog, color: '#F05032' },
  '.mailmap': { icon: FileCog, color: '#F05032' },

  // License
  'license': { icon: Scale, color: '#D4AA00' },
  'license.md': { icon: Scale, color: '#D4AA00' },
  'license.txt': { icon: Scale, color: '#D4AA00' },
  'licence': { icon: Scale, color: '#D4AA00' },
  'licence.md': { icon: Scale, color: '#D4AA00' },
  'copying': { icon: Scale, color: '#D4AA00' },
  'authors': { icon: Scale, color: '#D4AA00' },

  // Readme / Docs
  'readme.md': { icon: BookOpen, color: '#519ABA' },
  'readme.txt': { icon: BookOpen, color: '#519ABA' },
  'readme': { icon: BookOpen, color: '#519ABA' },
  'changelog.md': { icon: Scroll, color: '#519ABA' },
  'changelog': { icon: Scroll, color: '#519ABA' },
  'history.md': { icon: Scroll, color: '#519ABA' },
  'contributing.md': { icon: BookOpen, color: '#519ABA' },
  'code_of_conduct.md': { icon: BookOpen, color: '#519ABA' },
  'security.md': { icon: ShieldCheck, color: '#22C55E' },
  '.codeowners': { icon: FileCheck, color: '#519ABA' },
  'robots.txt': { icon: Globe, color: '#6D8086' },
  'humans.txt': { icon: FileText, color: '#6D8086' },

  // Env
  '.env': { icon: FileKey, color: '#ECD53F' },
  '.env.local': { icon: FileKey, color: '#ECD53F' },
  '.env.development': { icon: FileKey, color: '#ECD53F' },
  '.env.production': { icon: FileKey, color: '#ECD53F' },
  '.env.staging': { icon: FileKey, color: '#ECD53F' },
  '.env.test': { icon: FileKey, color: '#ECD53F' },
  '.env.example': { icon: FileKey, color: '#ECD53F' },

  // Editor config
  '.editorconfig': { icon: FileCog, color: '#FEFEFE' },

  // Shell config
  '.bashrc': { icon: FileTerminal, color: '#89E051' },
  '.bash_profile': { icon: FileTerminal, color: '#89E051' },
  '.bash_aliases': { icon: FileTerminal, color: '#89E051' },
  '.zshrc': { icon: FileTerminal, color: '#89E051' },
  '.zprofile': { icon: FileTerminal, color: '#89E051' },
  '.profile': { icon: FileTerminal, color: '#89E051' },
  '.tmux.conf': { icon: FileTerminal, color: '#1BB91F' },
  '.vimrc': { icon: FileTerminal, color: '#019833' },

  // Build tools
  'makefile': { icon: Terminal, color: '#6D8086' },
  'cmakelists.txt': { icon: Terminal, color: '#064F8C' },
  'rakefile': { icon: Terminal, color: '#CC342D' },
  'gulpfile.js': { icon: Terminal, color: '#CF4647' },
  'gulpfile.ts': { icon: Terminal, color: '#CF4647' },
  'gruntfile.js': { icon: Terminal, color: '#FAA432' },
  'taskfile.yml': { icon: Terminal, color: '#29BEB0' },

  // Language-specific manifests
  'gemfile': { icon: FileCode2, color: '#CC342D' },
  'gemfile.lock': { icon: FileLock, color: '#CC342D' },
  'cargo.toml': { icon: FileCog, color: '#DEA584' },
  'cargo.lock': { icon: FileLock, color: '#DEA584' },
  'go.mod': { icon: FileCog, color: '#00ADD8' },
  'go.sum': { icon: FileLock, color: '#00ADD8' },
  'requirements.txt': { icon: FileCog, color: '#3776AB' },
  'pyproject.toml': { icon: FileCog, color: '#3776AB' },
  'pipfile': { icon: FileCog, color: '#3776AB' },
  'pipfile.lock': { icon: FileLock, color: '#3776AB' },
  'setup.py': { icon: FileCog, color: '#3776AB' },
  'setup.cfg': { icon: FileCog, color: '#3776AB' },
  'poetry.lock': { icon: FileLock, color: '#3776AB' },
  'composer.json': { icon: Braces, color: '#F28D1A' },
  'composer.lock': { icon: FileLock, color: '#F28D1A' },
  'build.gradle': { icon: Terminal, color: '#02303A' },
  'build.gradle.kts': { icon: Terminal, color: '#02303A' },
  'settings.gradle': { icon: FileCog, color: '#02303A' },
  'pom.xml': { icon: FileCode2, color: '#B07219' },
  'mix.exs': { icon: FileCog, color: '#6E4A7E' },
  'mix.lock': { icon: FileLock, color: '#6E4A7E' },
  'pubspec.yaml': { icon: FileCog, color: '#0175C2' },
  'pubspec.lock': { icon: FileLock, color: '#0175C2' },
  'stack.yaml': { icon: FileCog, color: '#5D4F85' },
  'cabal.project': { icon: FileCog, color: '#5D4F85' },
  'deno.json': { icon: Braces, color: '#70FFAF' },
  'deno.jsonc': { icon: Braces, color: '#70FFAF' },
  'deno.lock': { icon: FileLock, color: '#70FFAF' },

  // CI/CD
  '.travis.yml': { icon: FileCog, color: '#CB2027' },
  '.appveyor.yml': { icon: FileCog, color: '#00B3E0' },
  'appveyor.yml': { icon: FileCog, color: '#00B3E0' },
  '.drone.yml': { icon: FileCog, color: '#212121' },
  'azure-pipelines.yml': { icon: FileCog, color: '#0078D4' },
  '.circleci/config.yml': { icon: FileCog, color: '#343434' },
  'jenkinsfile': { icon: FileCog, color: '#D24939' },
  'procfile': { icon: Server, color: '#430098' },

  // Linters / Formatters
  '.eslintrc': { icon: FileCheck, color: '#4B32C3' },
  '.eslintrc.js': { icon: FileCheck, color: '#4B32C3' },
  '.eslintrc.cjs': { icon: FileCheck, color: '#4B32C3' },
  '.eslintrc.json': { icon: FileCheck, color: '#4B32C3' },
  '.eslintrc.yml': { icon: FileCheck, color: '#4B32C3' },
  '.eslintignore': { icon: FileCheck, color: '#4B32C3' },
  '.prettierrc': { icon: Palette, color: '#F7B93E' },
  '.prettierrc.js': { icon: Palette, color: '#F7B93E' },
  '.prettierrc.cjs': { icon: Palette, color: '#F7B93E' },
  '.prettierrc.json': { icon: Palette, color: '#F7B93E' },
  '.prettierrc.yml': { icon: Palette, color: '#F7B93E' },
  '.prettierrc.toml': { icon: Palette, color: '#F7B93E' },
  '.prettierignore': { icon: Palette, color: '#F7B93E' },
  '.stylelintrc': { icon: Palette, color: '#263238' },
  '.stylelintrc.json': { icon: Palette, color: '#263238' },
  '.stylelintignore': { icon: Palette, color: '#263238' },
  '.markdownlint.json': { icon: FileCheck, color: '#519ABA' },
  '.markdownlint.yml': { icon: FileCheck, color: '#519ABA' },
  '.markdownlintrc': { icon: FileCheck, color: '#519ABA' },
  '.markdownlintignore': { icon: FileCheck, color: '#519ABA' },
  '.htmlhintrc': { icon: FileCheck, color: '#E44D26' },
  '.jshintrc': { icon: FileCheck, color: '#F7DF1E' },
  '.shellcheckrc': { icon: FileCheck, color: '#89E051' },
  'biome.json': { icon: FileCheck, color: '#60A5FA' },
  'biome.jsonc': { icon: FileCheck, color: '#60A5FA' },
  '.babelrc': { icon: FileCog, color: '#F5DA55' },
  'babel.config.js': { icon: FileCog, color: '#F5DA55' },
  'babel.config.json': { icon: FileCog, color: '#F5DA55' },
  '.swcrc': { icon: FileCog, color: '#F8C457' },

  // Testing
  '.mocharc.yml': { icon: FlaskConical, color: '#8D6748' },
  '.mocharc.json': { icon: FlaskConical, color: '#8D6748' },
  '.nycrc': { icon: FlaskConical, color: '#22C55E' },
  '.nycrc.json': { icon: FlaskConical, color: '#22C55E' },

  // Monorepo
  'lerna.json': { icon: Package, color: '#9333EA' },
  'nx.json': { icon: FileCog, color: '#143055' },
  'turbo.json': { icon: Rocket, color: '#EF4444' },
  'turbo.jsonc': { icon: Rocket, color: '#EF4444' },

  // Git hooks / Commitizen
  '.huskyrc': { icon: FileCog, color: '#6D8086' },
  '.huskyrc.json': { icon: FileCog, color: '#6D8086' },
  '.commitlintrc': { icon: FileCog, color: '#6D8086' },
  '.commitlintrc.json': { icon: FileCog, color: '#6D8086' },
  '.lintstagedrc': { icon: FileCog, color: '#6D8086' },
  '.lintstagedrc.json': { icon: FileCog, color: '#6D8086' },
  '.czrc': { icon: FileCog, color: '#6D8086' },
  '.pre-commit-config.yaml': { icon: FileCog, color: '#FAB040' },

  // Deployment / Hosting
  'vercel.json': { icon: Cloud, color: '#FEFEFE' },
  'netlify.toml': { icon: Cloud, color: '#00C7B7' },
  'fly.toml': { icon: Cloud, color: '#7B3BE2' },
  'firebase.json': { icon: Cloud, color: '#FFCA28' },
  '.firebaserc': { icon: Cloud, color: '#FFCA28' },
  'railway.json': { icon: Cloud, color: '#0B0D0E' },
  'render.yaml': { icon: Cloud, color: '#46E3B7' },
  'serverless.yml': { icon: Cloud, color: '#FD5750' },
  'serverless.yaml': { icon: Cloud, color: '#FD5750' },
  'now.json': { icon: Cloud, color: '#FEFEFE' },
  'wrangler.toml': { icon: Cloud, color: '#F38020' },
  'wrangler.jsonc': { icon: Cloud, color: '#F38020' },

  // Security scanning
  '.snyk': { icon: ShieldCheck, color: '#4C4A73' },
  'dependabot.yml': { icon: ShieldCheck, color: '#0366D6' },
  '.dependabot/config.yml': { icon: ShieldCheck, color: '#0366D6' },

  // DevContainer
  '.devcontainer.json': { icon: Container, color: '#0066B8' },
  'devcontainer.json': { icon: Container, color: '#0066B8' },

  // Misc config
  'renovate.json': { icon: FileCog, color: '#1A8CFF' },
  'renovate.json5': { icon: FileCog, color: '#1A8CFF' },
  '.renovaterc': { icon: FileCog, color: '#1A8CFF' },
  '.renovaterc.json': { icon: FileCog, color: '#1A8CFF' },
  '.browserslistrc': { icon: Globe, color: '#FFC107' },
  'nodemon.json': { icon: FileCog, color: '#76D04B' },
  '.flowconfig': { icon: FileCog, color: '#E8BD36' },
  '.watchmanconfig': { icon: FileCog, color: '#6D8086' },
  '.sentryclirc': { icon: Bug, color: '#362D59' },

  // Prisma
  'schema.prisma': { icon: Database, color: '#2D3748' },

  // Kubernetes / Helm
  'helmfile.yaml': { icon: Network, color: '#0F1689' },

  // Cursor / AI
  '.cursorrules': { icon: FileCog, color: '#FEFEFE' },
  '.cursorignore': { icon: FileCog, color: '#FEFEFE' }
}

// Level 2: Pattern matches (checked in order, first match wins)
interface PatternMatch {
  test: (name: string) => boolean
  info: FileIconInfo
}

const PATTERN_MATCHES: PatternMatch[] = [
  // CI/CD
  { test: (n) => n === '.gitlab-ci.yml' || n.endsWith('.gitlab-ci.yml'), info: { icon: FileCog, color: '#FC6D26' } },
  { test: (n) => n.includes('.github/') && (n.endsWith('.yml') || n.endsWith('.yaml')), info: { icon: FileCog, color: '#FEFEFE' } },
  { test: (n) => n.startsWith('.bitbucket-pipelines'), info: { icon: FileCog, color: '#0052CC' } },

  // Env variants (catch .env.anything)
  { test: (n) => n.startsWith('.env.'), info: { icon: FileKey, color: '#ECD53F' } },

  // Config files by pattern
  { test: (n) => n.startsWith('eslint.config.'), info: { icon: FileCheck, color: '#4B32C3' } },
  { test: (n) => n.startsWith('prettier.config.'), info: { icon: Palette, color: '#F7B93E' } },
  { test: (n) => n.startsWith('stylelint.config.'), info: { icon: Palette, color: '#263238' } },
  { test: (n) => n.startsWith('tailwind.config.'), info: { icon: Palette, color: '#06B6D4' } },
  { test: (n) => n.startsWith('postcss.config.'), info: { icon: FileCog, color: '#DD3A0A' } },
  { test: (n) => n.startsWith('vite.config.'), info: { icon: FileCog, color: '#646CFF' } },
  { test: (n) => n.startsWith('webpack.config.'), info: { icon: FileCog, color: '#8DD6F9' } },
  { test: (n) => n.startsWith('rollup.config.'), info: { icon: FileCog, color: '#EF3335' } },
  { test: (n) => n.startsWith('esbuild.') || n.startsWith('.esbuild'), info: { icon: FileCog, color: '#FFCF00' } },
  { test: (n) => n.startsWith('jest.config.') || n.startsWith('vitest.config.'), info: { icon: FlaskConical, color: '#22C55E' } },
  { test: (n) => n.startsWith('vitest.workspace.'), info: { icon: FlaskConical, color: '#22C55E' } },
  { test: (n) => n.startsWith('playwright.config.'), info: { icon: FlaskConical, color: '#2EAD33' } },
  { test: (n) => n.startsWith('cypress.config.'), info: { icon: FlaskConical, color: '#17202C' } },
  { test: (n) => n.startsWith('tsconfig.') && n.endsWith('.json'), info: { icon: Braces, color: '#3178C6' } },
  { test: (n) => n.startsWith('commitlint.config.'), info: { icon: FileCog, color: '#6D8086' } },
  { test: (n) => n.startsWith('lint-staged.config.'), info: { icon: FileCog, color: '#6D8086' } },
  { test: (n) => n.startsWith('release.config.'), info: { icon: FileCog, color: '#6D8086' } },

  // Framework configs
  { test: (n) => n.startsWith('next.config.'), info: { icon: FileCog, color: '#FEFEFE' } },
  { test: (n) => n.startsWith('nuxt.config.'), info: { icon: FileCog, color: '#00DC82' } },
  { test: (n) => n.startsWith('svelte.config.'), info: { icon: FileCog, color: '#FF3E00' } },
  { test: (n) => n.startsWith('astro.config.'), info: { icon: FileCog, color: '#FF5D01' } },
  { test: (n) => n.startsWith('remix.config.'), info: { icon: FileCog, color: '#FEFEFE' } },
  { test: (n) => n.startsWith('gatsby-config.'), info: { icon: FileCog, color: '#663399' } },
  { test: (n) => n.startsWith('angular.json'), info: { icon: FileCog, color: '#DD0031' } },

  // Hardhat / Truffle (blockchain)
  { test: (n) => n.startsWith('hardhat.config.'), info: { icon: Hexagon, color: '#FFF100' } },
  { test: (n) => n.startsWith('truffle-config.'), info: { icon: Hexagon, color: '#5E464D' } },
  { test: (n) => n.startsWith('foundry.toml'), info: { icon: Hexagon, color: '#FFF100' } },

  // Test files
  { test: (n) => /\.(test|spec)\.\w+$/.test(n), info: { icon: FlaskConical, color: '#22C55E' } },

  // Storybook
  { test: (n) => /\.stories\.\w+$/.test(n), info: { icon: BookOpen, color: '#FF4785' } },

  // TypeScript declarations
  { test: (n) => n.endsWith('.d.ts') || n.endsWith('.d.mts') || n.endsWith('.d.cts'), info: { icon: FileType, color: '#235A97' } },

  // Minified files
  { test: (n) => n.endsWith('.min.js') || n.endsWith('.min.css'), info: { icon: FileArchive, color: '#6D8086' } },

  // Source maps
  { test: (n) => n.endsWith('.map'), info: { icon: FileCog, color: '#6D8086' } },

  // Docker compose variants
  { test: (n) => n.startsWith('docker-compose') && (n.endsWith('.yml') || n.endsWith('.yaml')), info: { icon: Container, color: '#2496ED' } },
  { test: (n) => n.startsWith('dockerfile.'), info: { icon: Container, color: '#2496ED' } },

  // Kubernetes manifests
  { test: (n) => n.endsWith('.k8s.yml') || n.endsWith('.k8s.yaml'), info: { icon: Network, color: '#326CE5' } }
]

// Level 3: Extension matches
const EXTENSION_MAP: Record<string, FileIconInfo> = {
  // JavaScript / TypeScript
  ts: { icon: FileCode2, color: '#3178C6' },
  tsx: { icon: FileCode2, color: '#61DAFB' },
  js: { icon: FileCode2, color: '#F7DF1E' },
  jsx: { icon: FileCode2, color: '#61DAFB' },
  mjs: { icon: FileCode2, color: '#F7DF1E' },
  cjs: { icon: FileCode2, color: '#F7DF1E' },
  mts: { icon: FileCode2, color: '#3178C6' },
  cts: { icon: FileCode2, color: '#3178C6' },
  coffee: { icon: FileCode2, color: '#28334C' },

  // Web
  html: { icon: Globe, color: '#E44D26' },
  htm: { icon: Globe, color: '#E44D26' },
  css: { icon: Hash, color: '#563D7C' },
  scss: { icon: Hash, color: '#CD6799' },
  sass: { icon: Hash, color: '#CD6799' },
  less: { icon: Hash, color: '#1D365D' },
  styl: { icon: Hash, color: '#FF6347' },
  pcss: { icon: Hash, color: '#DD3A0A' },
  vue: { icon: FileCode2, color: '#42B883' },
  svelte: { icon: FileCode2, color: '#FF3E00' },
  astro: { icon: FileCode2, color: '#FF5D01' },

  // Templates
  ejs: { icon: Globe, color: '#A91E50' },
  hbs: { icon: Globe, color: '#F0772B' },
  mustache: { icon: Globe, color: '#724B24' },
  pug: { icon: Globe, color: '#A86454' },
  liquid: { icon: Globe, color: '#7AB55C' },
  twig: { icon: Globe, color: '#BACF29' },
  jsp: { icon: Globe, color: '#B07219' },
  aspx: { icon: Globe, color: '#512BD4' },
  haml: { icon: Globe, color: '#ECE2A9' },
  slim: { icon: Globe, color: '#2B2B2B' },

  // Data / Config
  json: { icon: Braces, color: '#F7DF1E' },
  jsonc: { icon: Braces, color: '#F7DF1E' },
  json5: { icon: Braces, color: '#F7DF1E' },
  jsonl: { icon: Braces, color: '#F7DF1E' },
  ndjson: { icon: Braces, color: '#F7DF1E' },
  jsonld: { icon: Braces, color: '#0166FF' },
  geojson: { icon: Braces, color: '#4BAE4F' },
  hjson: { icon: Braces, color: '#F7DF1E' },
  yaml: { icon: FileCode2, color: '#CB171E' },
  yml: { icon: FileCode2, color: '#CB171E' },
  toml: { icon: FileCog, color: '#9C4221' },
  ini: { icon: FileCog, color: '#6D8086' },
  cfg: { icon: FileCog, color: '#6D8086' },
  conf: { icon: FileCog, color: '#6D8086' },
  xml: { icon: FileCode2, color: '#E44D26' },
  csv: { icon: FileSpreadsheet, color: '#217346' },
  tsv: { icon: FileSpreadsheet, color: '#217346' },
  xls: { icon: FileSpreadsheet, color: '#217346' },
  xlsx: { icon: FileSpreadsheet, color: '#217346' },
  xlsm: { icon: FileSpreadsheet, color: '#217346' },
  plist: { icon: FileCog, color: '#6D8086' },
  diff: { icon: FileCode2, color: '#41B883' },
  patch: { icon: FileCode2, color: '#41B883' },
  org: { icon: FileText, color: '#77AA99' },

  // Programming languages
  py: { icon: FileCode2, color: '#3776AB' },
  pyw: { icon: FileCode2, color: '#3776AB' },
  pyx: { icon: FileCode2, color: '#FFD43B' },
  rb: { icon: FileCode2, color: '#CC342D' },
  go: { icon: FileCode2, color: '#00ADD8' },
  rs: { icon: FileCode2, color: '#DEA584' },
  java: { icon: Coffee, color: '#B07219' },
  kt: { icon: FileCode2, color: '#A97BFF' },
  kts: { icon: FileCode2, color: '#A97BFF' },
  swift: { icon: FileCode2, color: '#F05138' },
  c: { icon: FileCode2, color: '#555555' },
  cpp: { icon: FileCode2, color: '#F34B7D' },
  cc: { icon: FileCode2, color: '#F34B7D' },
  cxx: { icon: FileCode2, color: '#F34B7D' },
  h: { icon: FileCode2, color: '#555555' },
  hpp: { icon: FileCode2, color: '#F34B7D' },
  cs: { icon: FileCode2, color: '#178600' },
  php: { icon: FileCode2, color: '#4F5D95' },
  lua: { icon: FileCode2, color: '#000080' },
  r: { icon: FileCode2, color: '#276DC3' },
  scala: { icon: FileCode2, color: '#DC322F' },
  clj: { icon: FileCode2, color: '#63B132' },
  cljs: { icon: FileCode2, color: '#63B132' },
  ex: { icon: FileCode2, color: '#6E4A7E' },
  exs: { icon: FileCode2, color: '#6E4A7E' },
  erl: { icon: FileCode2, color: '#B83998' },
  hs: { icon: FileCode2, color: '#5D4F85' },
  dart: { icon: FileCode2, color: '#0175C2' },
  zig: { icon: FileCode2, color: '#F7A41D' },
  nim: { icon: FileCode2, color: '#FFE953' },
  v: { icon: FileCode2, color: '#5D87BF' },
  pl: { icon: FileCode2, color: '#0298C3' },
  elm: { icon: FileCode2, color: '#60B5CC' },
  gleam: { icon: FileCode2, color: '#FFAFF3' },
  cr: { icon: FileCode2, color: '#000100' },
  d: { icon: FileCode2, color: '#B03931' },
  f: { icon: FileCode2, color: '#734F96' },
  f90: { icon: FileCode2, color: '#734F96' },
  fs: { icon: FileCode2, color: '#B845FC' },
  fsx: { icon: FileCode2, color: '#B845FC' },
  groovy: { icon: FileCode2, color: '#4298B8' },
  jl: { icon: FileCode2, color: '#9558B2' },
  lean: { icon: FileCode2, color: '#FEFEFE' },
  lisp: { icon: FileCode2, color: '#3FB68B' },
  m: { icon: FileCode2, color: '#438EFF' },
  mm: { icon: FileCode2, color: '#438EFF' },
  ml: { icon: FileCode2, color: '#3BE133' },
  mojo: { icon: FileCode2, color: '#FF7000' },
  nix: { icon: FileCode2, color: '#7EBAE4' },
  nu: { icon: FileCode2, color: '#3AA675' },
  pas: { icon: FileCode2, color: '#E3F171' },
  purs: { icon: FileCode2, color: '#14161A' },
  raku: { icon: FileCode2, color: '#0298C3' },
  re: { icon: FileCode2, color: '#DD4B39' },
  res: { icon: FileCode2, color: '#DD4B39' },
  rkt: { icon: FileCode2, color: '#9F1D20' },
  sol: { icon: Hexagon, color: '#1C1C1C' },
  vb: { icon: FileCode2, color: '#945DB7' },
  vhdl: { icon: FileCode2, color: '#543978' },
  vim: { icon: FileCode2, color: '#019833' },
  wgsl: { icon: FileCode2, color: '#4285F4' },
  asm: { icon: FileCode2, color: '#6E4C13' },
  xaml: { icon: FileCode2, color: '#0C54C2' },

  // DevOps / Infrastructure
  tf: { icon: FileCog, color: '#7B42BC' },
  tfvars: { icon: FileCog, color: '#7B42BC' },
  hcl: { icon: FileCog, color: '#7B42BC' },
  bicep: { icon: Cloud, color: '#0078D4' },
  rego: { icon: FileCog, color: '#566366' },
  prisma: { icon: Database, color: '#2D3748' },

  // Shell / Scripts
  sh: { icon: FileTerminal, color: '#89E051' },
  bash: { icon: FileTerminal, color: '#89E051' },
  zsh: { icon: FileTerminal, color: '#89E051' },
  fish: { icon: FileTerminal, color: '#89E051' },
  ps1: { icon: FileTerminal, color: '#012456' },
  psm1: { icon: FileTerminal, color: '#012456' },
  bat: { icon: FileTerminal, color: '#C1F12E' },
  cmd: { icon: FileTerminal, color: '#C1F12E' },

  // Documents
  md: { icon: BookOpen, color: '#519ABA' },
  mdx: { icon: BookOpen, color: '#519ABA' },
  txt: { icon: FileText, color: '#6D8086' },
  rst: { icon: FileText, color: '#6D8086' },
  pdf: { icon: FileText, color: '#EC1C24' },
  doc: { icon: FileText, color: '#2B579A' },
  docx: { icon: FileText, color: '#2B579A' },
  docm: { icon: FileText, color: '#2B579A' },
  rtf: { icon: FileText, color: '#6D8086' },
  tex: { icon: FileText, color: '#3D6117' },
  latex: { icon: FileText, color: '#3D6117' },
  epub: { icon: BookOpen, color: '#6D8086' },
  odt: { icon: FileText, color: '#0060BF' },
  ppt: { icon: FileText, color: '#B7472A' },
  pptx: { icon: FileText, color: '#B7472A' },
  ods: { icon: FileSpreadsheet, color: '#0060BF' },

  // Images
  png: { icon: FileImage, color: '#A074C4' },
  jpg: { icon: FileImage, color: '#A074C4' },
  jpeg: { icon: FileImage, color: '#A074C4' },
  gif: { icon: FileImage, color: '#A074C4' },
  webp: { icon: FileImage, color: '#A074C4' },
  avif: { icon: FileImage, color: '#A074C4' },
  heic: { icon: FileImage, color: '#A074C4' },
  ico: { icon: FileImage, color: '#A074C4' },
  icns: { icon: FileImage, color: '#A074C4' },
  bmp: { icon: FileImage, color: '#A074C4' },
  tiff: { icon: FileImage, color: '#A074C4' },
  raw: { icon: FileImage, color: '#A074C4' },
  eps: { icon: FileImage, color: '#A074C4' },
  svg: { icon: Image, color: '#FFB13B' },
  psd: { icon: FileImage, color: '#31A8FF' },
  ai: { icon: FileImage, color: '#FF9A00' },
  fig: { icon: FileImage, color: '#A259FF' },
  sketch: { icon: PenTool, color: '#FDAD00' },
  xd: { icon: PenTool, color: '#FF61F6' },

  // 3D / CAD
  blend: { icon: Box, color: '#F5792A' },
  fbx: { icon: Box, color: '#006090' },
  glb: { icon: Box, color: '#5C913B' },
  gltf: { icon: Box, color: '#5C913B' },
  stl: { icon: Box, color: '#6D8086' },
  obj: { icon: Box, color: '#6D8086' },

  // Fonts
  otf: { icon: FileType, color: '#6D8086' },
  ttf: { icon: FileType, color: '#6D8086' },
  woff: { icon: FileType, color: '#6D8086' },
  woff2: { icon: FileType, color: '#6D8086' },
  eot: { icon: FileType, color: '#6D8086' },

  // Audio
  mp3: { icon: FileAudio, color: '#E91E63' },
  wav: { icon: FileAudio, color: '#E91E63' },
  ogg: { icon: FileAudio, color: '#E91E63' },
  flac: { icon: FileAudio, color: '#E91E63' },
  aac: { icon: FileAudio, color: '#E91E63' },
  m4a: { icon: FileAudio, color: '#E91E63' },
  opus: { icon: FileAudio, color: '#E91E63' },
  wma: { icon: FileAudio, color: '#E91E63' },
  aiff: { icon: FileAudio, color: '#E91E63' },

  // Video
  mp4: { icon: FileVideo, color: '#FF6F00' },
  webm: { icon: FileVideo, color: '#FF6F00' },
  avi: { icon: FileVideo, color: '#FF6F00' },
  mkv: { icon: FileVideo, color: '#FF6F00' },
  mov: { icon: FileVideo, color: '#FF6F00' },
  wmv: { icon: FileVideo, color: '#FF6F00' },
  flv: { icon: FileVideo, color: '#FF6F00' },
  mpg: { icon: FileVideo, color: '#FF6F00' },
  mpeg: { icon: FileVideo, color: '#FF6F00' },
  m4v: { icon: FileVideo, color: '#FF6F00' },
  '3gp': { icon: FileVideo, color: '#FF6F00' },

  // Archives
  zip: { icon: FileArchive, color: '#FFC107' },
  tar: { icon: FileArchive, color: '#FFC107' },
  gz: { icon: FileArchive, color: '#FFC107' },
  tgz: { icon: FileArchive, color: '#FFC107' },
  bz2: { icon: FileArchive, color: '#FFC107' },
  xz: { icon: FileArchive, color: '#FFC107' },
  rar: { icon: FileArchive, color: '#FFC107' },
  '7z': { icon: FileArchive, color: '#FFC107' },
  deb: { icon: FileArchive, color: '#A81D33' },
  rpm: { icon: FileArchive, color: '#EE0000' },
  dmg: { icon: FileArchive, color: '#6D8086' },
  pkg: { icon: FileArchive, color: '#6D8086' },
  jar: { icon: FileArchive, color: '#B07219' },
  war: { icon: FileArchive, color: '#B07219' },
  whl: { icon: FileArchive, color: '#3776AB' },

  // Executables / Binaries
  exe: { icon: FileArchive, color: '#6D8086' },
  dll: { icon: FileArchive, color: '#6D8086' },
  so: { icon: FileArchive, color: '#6D8086' },
  dylib: { icon: FileArchive, color: '#6D8086' },

  // Database
  sql: { icon: Database, color: '#F29111' },
  db: { icon: Database, color: '#F29111' },
  sqlite: { icon: Database, color: '#003B57' },
  sqlite3: { icon: Database, color: '#003B57' },

  // Security / Keys
  pem: { icon: FileLock, color: '#CB3837' },
  key: { icon: FileKey, color: '#CB3837' },
  cert: { icon: FileCheck, color: '#22C55E' },
  crt: { icon: FileCheck, color: '#22C55E' },
  csr: { icon: FileCheck, color: '#22C55E' },
  cer: { icon: FileCheck, color: '#22C55E' },
  der: { icon: FileCheck, color: '#22C55E' },
  p12: { icon: FileLock, color: '#CB3837' },
  pfx: { icon: FileLock, color: '#CB3837' },
  gpg: { icon: FileLock, color: '#0093DD' },

  // Misc
  log: { icon: Scroll, color: '#6D8086' },
  lock: { icon: FileLock, color: '#6D8086' },
  wasm: { icon: FileCode2, color: '#654FF0' },
  graphql: { icon: FileCode2, color: '#E535AB' },
  gql: { icon: FileCode2, color: '#E535AB' },
  proto: { icon: FileCode2, color: '#4285F4' },
  http: { icon: Globe, color: '#005AA0' },
  rest: { icon: Globe, color: '#005AA0' },
  env: { icon: FileKey, color: '#ECD53F' }
}

/**
 * Get the icon and color for a file based on its name.
 * Checks in order: exact filename → pattern match → extension.
 * Returns null if no mapping is found (caller should use default icon).
 */
export function getFileIcon(fileName: string): FileIconInfo | null {
  const lower = fileName.toLowerCase()

  // Level 1: Exact filename match
  const exactMatch = FILENAME_MAP[lower]
  if (exactMatch) return exactMatch

  // Level 2: Pattern matches
  for (const pattern of PATTERN_MATCHES) {
    if (pattern.test(lower)) return pattern.info
  }

  // Level 3: Extension match
  const lastDot = lower.lastIndexOf('.')
  if (lastDot !== -1) {
    const ext = lower.substring(lastDot + 1)
    const extMatch = EXTENSION_MAP[ext]
    if (extMatch) return extMatch
  }

  return null
}
