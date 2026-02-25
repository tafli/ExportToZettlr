import joplin from 'api';
import { FileSystemItem, ModelType, ExportContext, SettingItemType, SettingItemSubType } from 'api/types';
import * as path from 'path';

const SETTINGS_SECTION = 'exportToZettlr';
const SETTING_OUTPUT_PATH = 'outputPath';

joplin.plugins.register({
	onStart: async function() {
		// fs-extra is provided by Joplin's plugin sandbox
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const fs: any = joplin.require('fs-extra');

		// ── Register plugin settings ─────────────────────────────────────────
		await joplin.settings.registerSection(SETTINGS_SECTION, {
			label: 'Export To Zettlr',
			iconName: 'fas fa-file-export',
		});

		await joplin.settings.registerSettings({
			[SETTING_OUTPUT_PATH]: {
				value: '',
				type: SettingItemType.String,
				subType: SettingItemSubType.DirectoryPath,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Output directory',
				description:
					'Directory where exported Markdown files will be written. '
					+ 'When set, this overrides the folder chosen in the export dialog.',
			},
		});

		// Converts all Joplin internal links in a note body:
		//   ![alt](:/resourceId)  →  ![alt](<resourcesRelPath>/filename.ext)   (image)
		//   [text](:/resourceId)  →  [text](<resourcesRelPath>/filename.ext)   (attachment)
		//   [text](:/noteId)      →  [[noteId|text]]                            (note link)
		//
		// resourcesRelPath is either 'resources' (note at root) or '../resources'
		// (note in a notebook subfolder), so links stay correct regardless of depth.
		const convertLinks = (
			body: string,
			resourceMap: Record<string, string>,
			resourcesRelPath: string,
		): string => {
			// Image links — must be handled before plain links (leading `!`).
			body = body.replace(
				/!\[([^\]]*)\]\(:\/([a-f0-9]{32})\)/g,
				(_match, alt: string, id: string) => {
					const filename = resourceMap[id];
					return filename
						? `![${alt}](${resourcesRelPath}/${filename})`
						: `![${alt}](:/missing-${id})`;
				},
			);
			// Plain links — resource attachment or internal note link.
			body = body.replace(
				/\[([^\]]*)\]\(:\/([a-f0-9]{32})\)/g,
				(_match, text: string, id: string) => {
					const filename = resourceMap[id];
					return filename
						? `[${text}](${resourcesRelPath}/${filename})`  // attachment
						: `[[${id}|${text}]]`;                           // note link
				},
			);
			return body;
		};

		// Strips characters that are invalid in directory names on common OSes.
		const sanitizeDirName = (name: string): string =>
			name.replace(/[/\\:*?"<>|]/g, '_').trim() || '_unnamed';

		// Recursively builds the relative folder path by walking up the parent chain.
		// Called in onClose after all folder data has been collected.
		// Returns '' for items that live at the export root.
		const resolveFolderRelPath = (id: string): string => {
			if (!id || !folderRaw[id]) return '';
			const folder = folderRaw[id];
			const parentPath = resolveFolderRelPath(folder.parent_id);
			return parentPath
				? path.join(parentPath, folder.title)
				: folder.title;
		};

		// Returns the configured output path if set, otherwise falls back to
		// the destination chosen in the Joplin export dialog.
		const resolveDestPath = async (contextDestPath: string): Promise<string> => {
			const configured: string = await joplin.settings.value(SETTING_OUTPUT_PATH);
			return configured && configured.trim() !== '' ? configured.trim() : contextDestPath;
		};

		// ── Closure variables shared across all export callbacks ─────────────
		// Joplin does not preserve context.userData between callback invocations
		// (each call receives a fresh context object), so we use closures instead.
		let resourceMap: Record<string, string> = {};
		// Maps folder ID → { sanitized title, parent_id } for recursive path resolution.
		let folderRaw: Record<string, { title: string; parent_id: string }> = {};
		let pendingNotes: Array<{
			parent_id: string;
			id: string;
			frontMatter: string;
			body: string;
		}> = [];

		await joplin.interop.registerExportModule({
			format: 'zettlr',
			description: 'Zettlr Markdown',
			target: FileSystemItem.Directory,
			isNoteArchive: false,

			onInit: async (_context: ExportContext) => {
				// Reset state at the start of each export run.
				resourceMap = {};
				folderRaw = {};
				pendingNotes = [];
			},

			onProcessItem: async (context: ExportContext, itemType: number, item: any) => {
				// Record notebooks so notes can be placed in the right subfolder.
				if (itemType === ModelType.Folder) {
					folderRaw[item.id] = {
						title: sanitizeDirName(item.title as string),
						parent_id: (item.parent_id as string) || '',
					};
					return;
				}

				// Only process notes.
				if (itemType !== ModelType.Note) return;

				// ── Fetch all tags for this note (paginated) ──────────────────
				const tags: string[] = [];
				let page = 1;
				while (true) {
					const result = await joplin.data.get(
						['notes', item.id, 'tags'],
						{ fields: ['title'], page },
					);
					for (const tag of (result.items ?? [])) {
						tags.push(tag.title as string);
					}
					if (!result.has_more) break;
					page++;
				}

				// ── Build YAML front matter ───────────────────────────────────
				const createdIso = new Date(item.created_time as number).toISOString();
				const escapedTitle = (item.title as string)
					.replace(/\\/g, '\\\\')
					.replace(/"/g, '\\"');
				const tagLines = tags.length > 0
					? `tags:\n${tags.map(t => `  - ${t}`).join('\n')}`
					: 'tags: []';

				const frontMatter = [
					'---',
					`id: ${item.id}`,
					`title: "${escapedTitle}"`,
					`created: ${createdIso}`,
					tagLines,
					'---',
				].join('\n');

				// ── Ensure a top-level heading exists ────────────────────────
				let body: string = (item.body as string) || '';
				const hasH1 = /^#\s/m.test(body);
				if (!hasH1) {
					body = `# ${item.title}\n\n${body}`;
				}

				// ── Defer writing until onClose (resources + full folder tree needed) ─
				pendingNotes.push({ parent_id: (item.parent_id as string) || '', id: item.id, frontMatter, body });
			},

			onProcessResource: async (context: ExportContext, resource: any, filePath: string) => {
				// Copy every resource into the root-level resources/ folder.
				// All notes (whether in subfolders or not) reference this single location.
				const filename = path.basename(filePath);
				const mainDestPath = await resolveDestPath(context.destPath);
				const resourcesDir = path.join(mainDestPath, 'resources');
				await fs.copy(filePath, path.join(resourcesDir, filename));
				resourceMap[resource.id] = filename;
			},

			onClose: async (context: ExportContext) => {
				// All items have been processed. Now the full folder tree is known,
				// so resolve each note's destination path recursively and write files.
				const mainDestPath = await resolveDestPath(context.destPath);
				for (const note of pendingNotes) {
					const folderRelPath = resolveFolderRelPath(note.parent_id);
					const noteDestPath = folderRelPath
						? path.join(mainDestPath, folderRelPath)
						: mainDestPath;
					// Depth determines how many '../' are needed to reach root resources/.
					const depth = folderRelPath ? folderRelPath.split(path.sep).length : 0;
					const resourcesRelPath = depth > 0
						? `${'../'.repeat(depth)}resources`
						: 'resources';
					const body = convertLinks(note.body, resourceMap, resourcesRelPath);
					const outFile = path.join(noteDestPath, `${note.id}.md`);
					await fs.outputFile(outFile, `${note.frontMatter}\n\n${body}`);
				}
			},
		});
	},
});
