# Export To Zettlr

A [Joplin](https://joplinapp.org/) plugin that exports notes as Markdown files ready to be opened in [Zettlr](https://www.zettlr.com/). It preserves your notebook hierarchy, converts all internal links to Zettlr-compatible formats, and adds a YAML front matter header to every note.

## Features

- Exports notes as `<noteId>.md` — the Joplin note ID becomes the filename, which Zettlr uses as the unique note identifier
- Adds a YAML front matter block to every note with `id`, `title`, `created`, and `tags`
- Mirrors your notebook hierarchy as subfolders, including nested sub-notebooks
- Converts internal note links to Zettlr wiki-links: `[[noteId|Link Text]]`
- Converts embedded images and file attachments to relative paths pointing to a shared `resources/` folder
- Injects a `# Title` heading into notes that do not already have one
- Configurable output directory via plugin settings

## Output structure

```
<output directory>/
├── Notebook A/
│   ├── Sub-Notebook/
│   │   └── <noteId>.md
│   └── <noteId>.md
├── Notebook B/
│   └── <noteId>.md
└── resources/
    ├── image.png
    └── document.pdf
```

Each Markdown file looks like this:

```markdown
---
id: a1b2c3d4e5f6...
title: "My Note Title"
created: 2024-01-15T10:30:00.000Z
tags:
  - project
  - ideas
---

# My Note Title

Note content goes here...
```

## Installation

1. Download `com.github.ExportToZettlr.jpl` from the [Releases](https://github.com/tafli/ExportToZettlr/releases) page
2. In Joplin, open **Preferences → Plugins**
3. Click the gear icon and choose **Install from file**
4. Select the downloaded `.jpl` file and restart Joplin

## Usage

### Export all notes

Go to **File → Export All → Zettlr Markdown**, then choose an output folder.

### Export a single notebook

Right-click any notebook in the sidebar, choose **Export → Zettlr Markdown**, then choose an output folder.

### Configure a fixed output directory

If you always export to the same folder (e.g. your Zettlr workspace), you can set a permanent output directory:

1. Open **Preferences → Plugins → Export To Zettlr**
2. Set **Output directory** to your Zettlr workspace folder

When this setting is filled in, it overrides the folder chosen in the export dialog.

## Link conversion

| Joplin | Exported as |
|---|---|
| Internal note link | `[[noteId\|Link Text]]` |
| Embedded image | `![alt](resources/filename.ext)` |
| File attachment | `[text](resources/filename.ext)` |

Notes in sub-notebooks use the correct relative path to resources (e.g. `../../resources/` for two levels deep).

## Building from source

```bash
npm install
npm run dist
```

The packaged plugin will be written to `publish/com.github.ExportToZettlr.jpl`.

## Requirements

- Joplin desktop 3.5 or later
