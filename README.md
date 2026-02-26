# SincroGitExclude

Desktop application for managing git-excluded files with built-in version control.

## Problem

In projects with sensitive configuration files (credentials, environment variables, local settings), these files are excluded from the repository via `.gitignore` or `.git/info/exclude`. The problem is that these files:

- Have no version control
- Are lost when switching machines or reinstalling
- Cannot be synced across multiple repositories that use the same file
- Have no way to view diffs or roll back to previous versions

SincroGitExclude solves this by creating an internal git repository for each managed file, enabling independent versioning and deployment to multiple repositories.

## Features

- **Single files and bundles**: Version a single file or an entire folder as a unit
- **Deployments**: Connect a managed file to a location in an external git repository
- **Auto-exclude**: Automatically adds deployed files to `.git/info/exclude` in the target repository
- **Change detection**: Watches deployed files and notifies when modifications are detected
- **Commits and checkout**: Create versions and restore previous states
- **Diffs**: View differences between versions or uncommitted changes
- **Source deployments**: When creating a new deployment, select an existing deployment and a specific commit as the starting point
- **Tags**: Organize files with colored labels
- **Export/Import**: Export and import all data as a ZIP archive
- **Bilingual**: UI available in English and Spanish

## Requirements

- Node.js 18+
- Git installed and available in PATH
- Windows (packaging is configured for Windows, but the code is cross-platform)

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

```bash
# Build only
npm run build

# Build + Windows installer
npm run build:win

# Build + portable directory
npm run build:unpack
```

## Tech Stack

- Electron 33
- React 18 + TypeScript
- Tailwind CSS v4
- better-sqlite3
- simple-git
- chokidar
- zustand
- i18next
- diff2html
- electron-builder
