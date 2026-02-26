# SincroGitExclude - User Manual

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Managing Files](#managing-files)
4. [Deployments](#deployments)
5. [Version Control](#version-control)
6. [Tags](#tags)
7. [Import & Export](#import--export)
8. [Settings](#settings)

---

## Overview

SincroGitExclude is a desktop application that solves a common problem in software development: managing files that are excluded from git repositories (credentials, environment variables, local configuration, etc.).

These files typically have no version control, are lost when switching machines, and cannot be synced across multiple repositories. SincroGitExclude creates an internal git repository for each managed file, enabling independent versioning and deployment to multiple locations.

### Key Concepts

- **Managed File**: A file or bundle tracked by SincroGitExclude with its own version history.
- **Bundle**: A group of files managed as a single unit (e.g., a configuration folder).
- **Deployment**: A connection between a managed file and a specific location in an external git repository.
- **Exclude**: Adding a file path to `.git/info/exclude` so git ignores it locally without modifying `.gitignore`.

---

## Getting Started

### Installation

Download the installer for your platform from the [Releases](https://github.com/mateof/SincroGitExclude/releases) page:

- **Windows**: `.exe` installer (NSIS)
- **macOS**: `.dmg` disk image (x64 and arm64)
- **Linux**: `.AppImage` or `.deb` package

#### macOS Note

The macOS builds are not signed with an Apple Developer certificate. After installing, run:

```bash
xattr -cr /Applications/SincroGitExclude.app
```

### First Launch

When you first open the application, you will see:

- A **sidebar** on the left listing your managed files (initially empty).
- A **dashboard** in the main area showing statistics.
- A **header** with navigation to Settings.

---

## Managing Files

### Creating a File

1. Click the **+** button at the top of the sidebar.
2. Choose the file type:
   - **Single file**: Tracks one file.
   - **Bundle**: Tracks a folder or multiple files as a unit.
3. For a **single file**:
   - Enter a name and optional alias.
   - Select the source file from your filesystem. The file content will be imported into SincroGitExclude's internal storage.
4. For a **bundle**:
   - Enter a name and optional alias.
   - Select a folder. All files within it will be tracked together.
5. Click **Create**.

### Editing a File

- Click on a file in the sidebar to open its detail view.
- Click the edit (pencil) icon next to the file name to change its name, alias, or tags.

### Deleting a File

- Click the delete button on the file detail page.
- Confirm the deletion. This will remove the file, all its deployments, and its entire version history.

---

## Deployments

A deployment connects a managed file to a target location inside a git repository.

### Creating a Deployment

1. Open a managed file from the sidebar.
2. Go to the **Deployments** tab.
3. Click **New Deployment**.
4. Select the destination folder inside a git repository using the folder picker.
   - For a single file, also specify the relative file path within the repository.
   - For a bundle, select the base directory where the bundle files will be placed.
5. Optionally choose a **source deployment** and **source commit** to start from an existing version.
6. Click **Create**.

The application will:
- Create a new branch in the internal repository for this deployment.
- Copy the file(s) to the target location.
- Optionally add the path(s) to `.git/info/exclude` (if auto-exclude is enabled).
- Start watching the deployed file(s) for changes.

### Deployment Card

Each deployment is shown as a card with the following information:

- **Repository name**: Last two segments of the repository path (hover for full path).
- **Relative path**: Path within the repository (hover for full absolute path).
- **Description**: Optional text to identify the deployment's purpose. Click to edit.
- **Status indicators**:
  - Active / Inactive
  - Excluded / Not excluded (whether the file is in `.git/info/exclude`)
  - Globally excluded (whether the file matches a pattern in the global gitexclude)
  - Has changes (whether the deployed file has been modified since last commit)

### Deployment Actions

When a deployment is **active**:

| Action | Description |
|--------|-------------|
| **Exclude toggle** | Add or remove the file from `.git/info/exclude` |
| **View file** | Open the current file content in a viewer |
| **View diff** | See differences between the deployed file and the last committed version (only when changes are detected) |
| **Commit** | Save the current state of the deployed file as a new version |
| **Open folder** | Open the deployment location in the system file explorer |
| **History** | View the commit history for this deployment |
| **New deployment** | Create a new deployment using this one as the source |
| **Deactivate** | Stop watching and exclude management (the file remains on disk) |

When a deployment is **inactive**:

| Action | Description |
|--------|-------------|
| **Reactivate** | Resume watching and exclude management |
| **Open folder** | Open the deployment location in the file explorer |
| **History** | View commit history |
| **Delete** | Permanently remove the deployment, with the option to also delete the file from disk |

### Deployment Description

Each deployment has an optional description field:

- Click **"Add description"** to add a note identifying the deployment's purpose.
- Click on an existing description to edit it.
- Press **Enter** or click the check button to save.
- Press **Escape** or click the X button to cancel.

---

## Version Control

### Committing Changes

When a deployed file is modified, the application detects the change and shows a "Has changes" indicator. To save the current state:

1. Click the **Commit** button on the deployment card.
2. Enter a commit message describing the change.
3. Click **Commit**.

This saves a snapshot of the file in the internal git repository. You can later view, compare, or restore any committed version.

### Viewing History

Click **History** on any deployment card to see the timeline of commits:

- Each commit shows the message, date, and hash.
- You can **view the diff** between any two commits.
- You can **checkout** a previous commit to restore the file to that state.
- You can **create a new deployment** from any specific commit.

### Checkout (Restore)

To restore a file to a previous version:

1. Open the commit history.
2. Find the desired commit.
3. Click the checkout button.
4. Confirm the action.

This will update both the internal repository and the deployed file on disk.

### Viewing Diffs

- **Uncommitted changes**: Click "View diff" on a deployment card when changes are detected.
- **Between commits**: From the history view, select a commit to see what changed.

The diff viewer uses a side-by-side or unified format with syntax highlighting.

---

## Tags

Tags help organize managed files with colored labels.

### Creating Tags

- Tags are created directly from the file edit dialog.
- Enter a tag name and select a color.
- Tags are shared across all files.

### Filtering by Tags

- In the sidebar, click on a tag to filter the file list.
- Only files with the selected tag will be shown.

### Managing Tags

- Go to **Settings > Manage tags** to view all tags.
- You can delete tags from the settings. Tags in use will remain assigned to files until removed manually.

---

## Import & Export

### Export

1. Go to **Settings**.
2. Click **Export data**.
3. Choose a destination for the ZIP file.

The export includes the database and all file version histories. Use this to create backups or transfer data between machines.

### Import

1. Go to **Settings**.
2. Click **Import data**.
3. Select a previously exported ZIP file.

**Warning**: Importing replaces all existing data. The application will restart after a successful import.

---

## Settings

Access settings from the gear icon in the header.

### Theme

Switch between **Dark** and **Light** appearance.

### Language

Choose between **English** and **Spanish** (Espanol).

### Auto-exclude on Deploy

- **Automatic** (default): When creating a deployment, the file path is automatically added to `.git/info/exclude` in the target repository.
- **Manual**: You must add the exclusion manually from the deployment card.

### Application Data

View and change where the application stores its data:

- **Database**: The SQLite database file.
- **Managed files**: The directory containing internal git repositories.
- Click **Change location** to move all data to a different directory (with options to copy existing data).
- Click **Reset to default** to return to the standard location.

The application will restart after changing the data location.

### About

Shows the application version and a link to the GitHub repository. The update checker automatically verifies if a newer version is available.
