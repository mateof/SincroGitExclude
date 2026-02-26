export interface FileTag {
  id: string
  name: string
  color: string
  fileCount?: number
}

export interface ManagedFile {
  id: string
  name: string
  alias: string
  type: 'file' | 'bundle'
  useAutoIcon: boolean
  tags: FileTag[]
  createdAt: string
  updatedAt: string
}

export interface CreateFileInput {
  name: string
  alias: string
}

export interface UpdateFileInput {
  name?: string
  alias?: string
}
