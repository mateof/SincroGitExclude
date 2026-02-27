# SincroGitExclude - Contexto para desarrollo

## Que es este proyecto

Aplicacion de escritorio Electron que gestiona ficheros excluidos de repositorios git. Permite versionar, sincronizar y desplegar ficheros (individuales o conjuntos/bundles) que estan en `.git/info/exclude` de otros repositorios.

## Stack tecnologico

- **Electron 33** + **electron-vite** (bundler)
- **React 18** + **TypeScript** (renderer)
- **Tailwind CSS v4** (tema oscuro unico, sin tailwind.config — configuracion via CSS)
- **better-sqlite3** (base de datos local con migraciones versionadas)
- **simple-git** (operaciones git con mutex por repositorio)
- **chokidar** (vigilancia de ficheros/directorios)
- **zustand** (estado global en el renderer)
- **i18next** + **react-i18next** (bilingue EN/ES)
- **diff2html** (visualizacion de diffs)
- **lucide-react** (iconos)
- **electron-builder** (empaquetado Windows NSIS)

## Comandos

```bash
npm install                    # Instalar dependencias
npm run postinstall            # Reconstruir better-sqlite3 para Electron
npm run dev                    # Desarrollo con hot reload
npm run build                  # Compilar (electron-vite build)
npx electron-vite build        # Solo compilar sin empaquetar
npm run build:win              # Compilar + empaquetar instalador Windows
npm run build:unpack           # Compilar + directorio sin instalador
```

## Estructura del proyecto

```
src/
  main/                         # Proceso principal Electron
    index.ts                    # Entry point, crea ventana y servicios
    app-paths.ts                # Rutas de la app (userData, FILES_DIR, DB)
    database/
      connection.ts             # Singleton SQLite
      migrations.ts             # Migraciones versionadas (actualmente v1-v4)
    git/
      git-service.ts            # Wrapper simple-git con mutex por repo
      git-exclude.ts            # Leer/escribir .git/info/exclude
    services/
      file-service.ts           # CRUD ficheros gestionados (file + bundle)
      deployment-service.ts     # Crear/activar/desactivar/sincronizar despliegues
      commit-service.ts         # Commits, checkout, diff sobre repos internos
      watcher-service.ts        # Chokidar: vigilar cambios en ficheros desplegados
      export-service.ts         # Exportar datos a ZIP
      import-service.ts         # Importar datos desde ZIP
    ipc/
      register-all.ts           # Registra todos los handlers IPC
      file-handlers.ts          # IPC files:*
      deployment-handlers.ts    # IPC deployments:*
      commit-handlers.ts        # IPC commits:*
      exclude-handlers.ts       # IPC exclude:*
      app-handlers.ts           # IPC dialog:*, shell:*
      export-import-handlers.ts # IPC export/import
  preload/
    index.ts                    # Bridge contextIsolation
    index.d.ts                  # Tipos para window.api
  renderer/src/
    main.tsx                    # Entry React
    App.tsx                     # Root component
    assets/main.css             # Tailwind + tema oscuro CSS
    lib/utils.ts                # cn() helper (clsx + tailwind-merge)
    i18n/
      config.ts                 # Configuracion i18next
      en/*.json                 # Traducciones ingles
      es/*.json                 # Traducciones espanol
    types/
      index.ts                  # Re-exports
      file.ts                   # ManagedFile (type: 'file' | 'bundle')
      deployment.ts             # Deployment, CreateDeploymentInput
      commit.ts                 # CommitInfo
      ipc.ts                    # IpcResult<T>
    stores/
      file-store.ts             # Zustand: ficheros gestionados
      deployment-store.ts       # Zustand: despliegues
      watcher-store.ts          # Zustand: cambios detectados por watcher
      ui-store.ts               # Zustand: fichero seleccionado, idioma
    components/
      layout/
        MainLayout.tsx          # Layout principal con sidebar
        Header.tsx              # Barra superior
        Sidebar.tsx             # Lista de ficheros + filtro por tags
      files/
        FileList.tsx            # Lista de ficheros (sidebar content)
        FileCreateDialog.tsx    # Dialog crear fichero/bundle (selector unificado)
        FileEditDialog.tsx      # Dialog editar nombre/alias/tags
        TagSelector.tsx         # Selector de tags con colores
      deployments/
        DeploymentList.tsx      # Lista de despliegues de un fichero
        DeploymentCard.tsx      # Card individual con acciones
        DeploymentCreateDialog.tsx # Dialog crear despliegue (con selectores origen)
      commits/
        CommitHistory.tsx       # Timeline de commits
        CommitRow.tsx           # Fila individual con acciones
        CommitDialog.tsx        # Dialog crear commit
        CheckoutConfirm.tsx     # Confirmacion de checkout
      diff/
        DiffViewer.tsx          # Visualizador de diff con diff2html
    pages/
      DashboardPage.tsx         # Vista cuando no hay fichero seleccionado
      FileDetailPage.tsx        # Detalle de fichero: tabs despliegues/historial
      SettingsPage.tsx          # Ajustes: idioma, auto-exclude, tags, export/import
```

## Arquitectura

### Flujo de datos

```
Renderer (React)  --IPC-->  Main (Electron)  --FS/Git-->  Sistema de ficheros
   Zustand stores            ipc handlers
   Components                services
                             git-service (mutex)
                             database (SQLite)
```

### Patron IPC

Todos los handlers devuelven `{ success: boolean, data?: T, error?: string }`. El renderer invoca con `window.api.invoke<IpcResult<T>>('canal', ...args)`.

### Repositorios git internos

Cada fichero gestionado tiene un repo git en `{userData}/files/{uuid}/`:
- **Tipo `file`**: un unico fichero llamado `content`
- **Tipo `bundle`**: multiples ficheros con rutas relativas preservadas

### Despliegues

Un despliegue conecta un fichero gestionado con una ubicacion en un repo git externo:
- Crea una rama en el repo interno (`deploy-{id_corto}`)
- Copia los ficheros al destino
- Opcionalmente los anade a `.git/info/exclude` del repo destino
- Vigila cambios con chokidar
- Soporta seleccionar un despliegue existente como origen (branch) y un commit especifico

### Base de datos

SQLite con migraciones incrementales. Tablas: `files`, `deployments`, `tags`, `file_tags`, `schema_version`. Version actual: 6.

## Convenciones de codigo

- **Idioma del codigo**: ingles (variables, funciones, comentarios)
- **Idioma de la UI**: bilingue EN/ES con i18next
- **Estilos**: clases Tailwind CSS directas, tema oscuro unico, colores via CSS variables
- **Estado**: zustand sin middleware, pattern `create<Store>((set, get) => ({...}))`
- **Formularios**: estado local con useState, sin libreria de formularios
- **Dialogos**: modales custom con overlay, no libreria de UI
- **Iconos**: lucide-react exclusivamente
- **Git operations**: siempre via git-service con mutex (`withLock`)
- **Paths**: normalizar con `replace(/\\/g, '/')` al devolver al renderer
- **No tests**: el proyecto no tiene tests unitarios ni e2e
- **Verificacion**: `npx electron-vite build` debe compilar sin errores

## Estado actual

Todo implementado y funcional:
- Gestion de ficheros individuales y bundles (carpeta/multi-fichero)
- Despliegues con sincronizacion, exclude, watcher
- Commits, checkout, diff (single y multi-file)
- Selector de despliegue/commit de origen al crear nuevo despliegue
- Boton de nuevo despliegue desde cada card y cada commit
- Tags con colores para organizar ficheros
- Export/import de datos
- Ajustes: idioma, auto-exclude, gestion de tags, enlace GitHub
- Abrir carpeta en explorador desde cada despliegue
- Descripcion editable inline en cada despliegue
- Tooltips CSS instantaneos (sin delay)
- Indicador visual de fichero eliminado del disco
- Fechas de creacion y ultima modificacion en cada despliegue
- Boton commit oculto cuando no hay cambios
- Ubicacion de datos configurable (con copia de BD y ficheros)
- Licencia propietaria (all rights reserved)
- Manual de usuario en DOC/

## Flujo de publicacion (Git remotes)

El proyecto tiene dos remotos:

- **origin**: GitLab privado (`http://192.168.0.22:21080/mateo/sincrogitexclude.git`) — rama `master`
- **github**: GitHub publico (`https://github.com/mateof/SincroGitExclude.git`) — rama `main-github`

### Procedimiento de push

1. **Bump version** en `package.json` (minor o patch segun corresponda) antes de hacer push
2. **Commit y push a master** (GitLab):
   ```bash
   git add <ficheros>
   git commit -m "mensaje"
   git push origin master
   ```
3. **Actualizar main-github** (GitHub) — es una rama orphan que no comparte historial con master. Se sincroniza el contenido excluyendo `CLAUDE.md` y `custom.md`:
   ```bash
   git checkout main-github
   git checkout master -- .
   git rm -f CLAUDE.md custom.md
   git commit -m "mensaje"
   git push github main-github:main
   git checkout master
   ```

### Reglas importantes

- **NUNCA** subir `CLAUDE.md` ni `custom.md` a GitHub
- **NUNCA** incluir `Co-Authored-By` en los commits
- **Siempre** hacer bump de version antes de publicar a GitHub
