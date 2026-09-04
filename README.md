# SincroGitExclude

<p align="center">
  <a href="https://github.com/mateof/SincroGitExclude/actions/workflows/release.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/mateof/SincroGitExclude/release.yml?branch=main&amp;label=CI&amp;logo=github"></a>
  <a href="https://github.com/mateof/SincroGitExclude/releases/latest"><img alt="Version" src="https://img.shields.io/github/v/release/mateof/SincroGitExclude?label=version&amp;color=blue"></a>
  <a href="https://github.com/mateof/SincroGitExclude/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/mateof/SincroGitExclude/total?label=downloads&amp;color=success"></a>
  <a href="https://www.electronjs.org/"><img alt="Electron" src="https://img.shields.io/badge/Electron-Vite-47848F?logo=electron&amp;logoColor=white"></a>
  <a href="https://github.com/mateof/SincroGitExclude/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/mateof/SincroGitExclude"></a>
</p>

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

## Download

Pre-built installers for Windows, macOS and Linux are available on the [Releases](https://github.com/mateof/SincroGitExclude/releases) page.

### macOS note

The macOS builds are not signed with an Apple Developer certificate. Gatekeeper will block the app on first launch with the message *"SincroGitExclude is damaged and can't be opened"*.

To fix this, run the following command after installing:

```bash
xattr -cr /Applications/SincroGitExclude.app
```

### Prereleases

Test builds are published as GitHub prereleases on two channels:

- **beta** — release candidates (`v1.21.0-beta.1`)
- **dev** — builds of a pull request, before it is merged (`v1.21.0-dev.3`)

To publish one, add the `dev-release` or `beta-release` label to a pull request: the [Prerelease](.github/workflows/prerelease.yml) workflow builds that PR's head for Windows, macOS and Linux, publishes the prerelease and comments on the PR with the link. It can also be started from **Actions > Prerelease** (by PR number, branch or sha), or by pushing a `v*-dev*` / `v*-beta*` tag.

Prereleases are never marked as latest, so the stable release keeps its place on the repository front page. In the app, **Settings > About > Channel** selects which of these channels the update checker follows.

## Requirements

- Node.js 18+
- Git installed and available in PATH

## Installation (development)

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

## Documentation

See the [User Manual](DOC/user-manual.md) for detailed usage instructions.

## License

Copyright (c) 2026 Mateo Fuentes Pombo. All rights reserved.

Viewing the source code is permitted, but copying, modification, redistribution, or commercial use is strictly prohibited without prior written authorization from the author. See the [LICENSE](LICENSE) file for details.
