# Knowledge base

The Knowledge tab turns folders of Markdown notes (Obsidian vaults) into **spaces** that you can read in the app, sync between computers, share with other people, encrypt on the server and hand to AI assistants over MCP. The files stay plain Markdown on disk, so Obsidian keeps working on the same folder: the app never needs Obsidian open, and Obsidian never needs the app.

## Spaces

A space is a folder registered in the app. Its identity lives inside it, in `.sge-kb/space.json` (an id and a name), and Obsidian hides dot folders. A folder inside another space becomes a **nested space**: Obsidian still sees one tree and wikilinks resolve across both, but each space syncs on its own. That is how a shared team folder lives inside a personal vault.

| Setting | What it does |
|---|---|
| Storage | `none` (only this computer), `git`, `folder` (a mounted NAS share, an external disk…) or `sftp` |
| Every N minutes | Pull and push on a timer (0 turns it off) |
| Sync after every write | Sync two seconds after a write from the app or an assistant, and thirty seconds after Obsidian stops changing files |
| Commit Obsidian edits | Git only: commit external edits after a quiet period even when not syncing |
| Assistants can write | When off, MCP write tools refuse to change the space |
| Review before push | Writes made by assistants wait in a review queue; nothing leaves the computer until a person approves or undoes them |
| Shared | Turns on review and makes the secret scanner block uploads instead of only warning |

The index (titles, headings, links, tags, full text) is built in memory when the app starts and updated by a file watcher. It is never synced: every computer builds its own.

**Cloud-synced folders.** Git breaks inside Synology Drive, Dropbox, iCloud or OneDrive folders: the sync client rewrites files under git and the repository ends up corrupted. The app detects those folders, also through symbolic links, refuses git there, and offers *Move to a local folder*, which copies the space to a new folder and switches to it. The old folder is left alone. Stop syncing it with the cloud client once you checked the copy, and do not delete it inside the synced folder, because the deletion would reach every computer.

## Reading notes

The viewer renders Obsidian Markdown: properties from the frontmatter, wikilinks with alias, heading and block (`[[note#Heading|alias]]`), embeds of images and of notes or sections (`![[note#Section]]`), callouts (foldable with `-` and `+`), tags, `==highlights==`, `%%comments%%` (hidden), task lists, tables, footnotes, code highlighting and Mermaid diagrams. Links that do not resolve are shown as broken. A link from a shared space to a private one is flagged, because the people you share with would see it broken.

Links resolve like Obsidian: an exact path first, then the file name anywhere in the vault, preferring the same folder and then the shortest path.

HTML in notes is sanitized, scripts never run, external images are shown as links (loading them would tell their server you opened the note), and local images are read through the app with their path checked to stay inside the space.

**Open in Obsidian** uses `obsidian://open?path=…`, which works even when the folder is not registered as a vault in Obsidian.

Search with ⌘K / Ctrl K: words (accents do not matter, `#tag` filters by tag), meaning (semantic search) or both.

## Sync

### Git

The space folder is a normal repository with your notes on `main` (or the branch you choose), readable by any git client or by Obsidian Git. The app adds a `.gitignore` for the volatile Obsidian files (`.obsidian/workspace*.json`, the cache, `.trash/`) and excludes nested spaces through `.git/info/exclude`.

Each sync: commit local changes, fetch, merge (fast-forward when possible), push. It **never forces**. When two computers changed the same lines, the remote version stays in place and the local one is saved next to it as `note (conflict <machine> <date>).md`, so nothing is lost and both versions travel. A note edited here and deleted elsewhere is kept.

Each space chooses how it signs in:

| Authentication | When |
|---|---|
| The git setup of this computer | Default. SSH agent, system keychain, Git Credential Manager, or the helpers of `gh` and `glab` |
| User and token | Private repositories over HTTPS in Gitea, Forgejo, GitLab, GitHub or others. The settings link to the page of the server where the token is created |
| GitHub CLI session | Asks `gh` for the token on every sync, with the account you choose even if it is not the active one |
| A specific SSH key | Only that key is offered to the server |

Permissions of the token: **GitHub** fine-grained, *Contents: Read and write*; **GitLab** personal or project token with `write_repository`; **Gitea and Forgejo** write permission on repositories. The user can stay empty in GitHub and GitLab.

The token is stored in the system keychain, tied to the server of the space: changing the remote to another server does not send it there, and redirects to other servers do not receive it. It is never written to the repository, its URL or its configuration, and forgetting the space deletes it. It is not sent over plain `http://` except to private network addresses.

*Test connection* also says whether anyone can read the repository without signing in. The name and email of the commits can be set per space.

When the remote only has the commit a server creates with a new repository (README, LICENSE, .gitignore), the first sync builds on it and keeps the files of the space.

### Activity

The sync card shows the last exchange of files, when the next automatic sync runs and, in git spaces, the branch, the last commit with its files, commits still to send or receive (as of the last sync) and files not committed yet. *View activity* opens:

- **Syncs:** what started each one, the files it moved or deleted, conflicts, problems and how long it took. The app keeps the last 200 of each space that moved files or had problems, on this computer only. A repeated problem is counted in one entry. Syncs that found no changes are left out.
- **Commits** (git spaces without encryption): author, date, files and the diff of each file, with a link to the commit on GitHub, GitLab or Gitea.

A button next to the settings opens the repository in the browser. It needs an `https` remote, or an SSH remote on a server recognised as GitHub, GitLab or Gitea.

### Folder and SFTP

These use a three-way sync: the app remembers the hash of every file at the last sync and compares it with the local file and the remote file.

| Local | Remote | Result |
|---|---|---|
| changed | unchanged | upload |
| unchanged | changed | download |
| deleted | unchanged | delete on the remote |
| unchanged | deleted | move the local copy to `.trash/` |
| changed | changed, same content | nothing to do |
| changed | changed | keep both: remote in place, local as a conflict copy |
| deleted | changed | download (the edit wins) |
| changed | deleted | upload (the edit wins) |

Writes are atomic (temporary file and rename). A lock file with a two-minute lease keeps two computers from syncing the same remote at the same time. The sync stops instead of deleting more than half of the files on either side, which is what an unmounted share or a wrong path looks like.

SFTP authenticates with the SSH agent or a key file. The passphrase of the key, if any, is stored in the system keychain. The server fingerprint must be confirmed once with *Test connection*; if it changes later the sync stops and says so.

### Secrets

Before anything is uploaded the outgoing notes are scanned for things that look like credentials (private keys, cloud and git tokens, JWTs, `Bearer` headers, `password = …`). In shared spaces the upload is blocked; in personal ones the report lists them. Placeholders such as `${VAR}`, `$(command)` or `<your key>` are ignored, and a line can be allowed explicitly with `sge-kb:allow-secret`.

### Review of assistant writes

With *Review before push*, every write made through MCP is recorded with the token and tool that made it and the content before the change. The push waits until the queue is empty. Each change can be approved or undone from the space overview, with a side-by-side diff. Approving and undoing are not available over MCP.

## Encryption on the server

Any space with remote storage can be encrypted end to end: the remote only holds encrypted objects, and neither the content, nor the file names, nor the folder structure are visible there. The local copy stays readable for Obsidian. See [kb-encryption.md](kb-encryption.md) for the format and the threat model.

- **Turning it on** asks for a passphrase (or generates one), shows a 24-word recovery code and asks for three of its words before encrypting. With the passphrase or the code the space can always be opened again; without both and without any authorized device it cannot.
- **Use an empty destination**: a new folder or a new repository. The history of a repository that already held plain notes would still hold them.
- **Another computer** opens the space with the passphrase, or requests access. A computer that already has access shows the request with six words; when the requesting computer shows the same six words, approve it as *my device*, or as a *person* who can write or only read.
- **Removing access** changes the key of the space and encrypts everything again on the next sync. What the removed device already downloaded stays with it.
- Unlocking, approving requests and managing access only work in the app window, never over MCP or from a browser.

With git as storage, the app keeps a separate mirror repository with the encrypted objects in its data folder and pushes that one, with a neutral author (`sge-kb`) and the message `sync`.

## Linking a repository

The Knowledge tab of a repository links it to a note (usually `projects/<name>.md`, created from a template when it does not exist). Every file it writes goes to `.git/info/exclude`, never to `.gitignore`, so nothing shows up in `git status` and nothing is committed. Files already tracked by git are left alone, and worktrees are supported because they share the exclude file.

| File | Content |
|---|---|
| `.sge-kb.json` | Space, note and MCP address. Never a token |
| `.mcp.json` | A `sincrogitexclude-kb` server with `Authorization: Bearer ${SGE_KB_TOKEN}`. Skipped when the SincroGitExclude MCP is already configured for your user, so tools are not listed twice |
| `.claude/settings.local.json` | A `SessionStart` hook that prints the note at the start of each Claude Code session, even with the app closed. Existing settings and hooks are kept |
| `AGENTS.md` | A managed block between `<!-- sge-kb:start -->` and `<!-- sge-kb:end -->` for Codex, Cursor and other agents |

The vault keeps a registry of linked repositories (`.sge-kb/repos.json`, keyed by the normalized `origin` URL, so SSH and HTTPS remotes match). On another computer the repository page suggests linking it with one click.

When the knowledge base lives on another computer, link in *remote* mode: the hook fetches the note from `GET /kb/context` of that computer's MCP server, authenticated with the token in `SGE_KB_TOKEN`.

## Semantic search

Off by default. In Settings → Knowledge base choose:

- **Local**: runs on this computer in a separate process. EmbeddingGemma 300M (~330 MB, best quality) or a multilingual MiniLM (~120 MB, faster). The model is downloaded once to the data folder.
- **Ollama**: any embedding model served by Ollama, for example on the NAS.
- **OpenAI compatible**: any `/v1/embeddings` endpoint; the API key comes from an environment variable. The text of the notes is sent to that service.

Notes are split by heading. Only chunks that changed are embedded again, vectors are cached per computer and never synced, and hybrid search merges word and meaning results with reciprocal rank fusion.

## MCP

The knowledge tools (`kb_status`, `kb_search`, `kb_read`, `kb_list`, `kb_recent`, `kb_tags`, `kb_repo_context`, `kb_history`, `kb_sync`, `kb_create`, `kb_edit`, `kb_append`, `kb_patch_section`, `kb_set_frontmatter`, `kb_delete`) are described in [mcp.md](mcp.md). Every change needs the hash returned by `kb_read`, so an assistant can never overwrite an edit it has not seen.

### Setting spaces up from an assistant

`kb_add_space`, `kb_clone_space`, `kb_update_space` and `kb_test_space` let an assistant prepare a space. The first three need the `kb:admin` permission, which the primary token has.

- Name and sync schedule apply at once.
- Adding or cloning a folder, or changing the destination, its authentication or the commit identity, opens a dialog on the computer where the app runs. Nothing is applied without *Allow*; without an answer in about two minutes it is refused, and after a refusal there is a short pause.
- An assistant can turn protections on (review, shared, no assistant writes) but never off, cannot change the destination of an encrypted space, and cannot add hidden or system folders.
- Tokens are only typed in the app window. When one is missing the app opens the settings of the space.

### Editing the files directly

Any program can edit the files of a space. The watcher indexes the change, and it is synced about thirty seconds later with *Sync after every write*, or on the timer. Those edits count as made by the person: they skip the review queue, the audit and the hash check. Use the `kb_*` tools in shared spaces.
