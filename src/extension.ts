// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { parseAch, parseAchSummary, type AchDiagnostic } from './nachaParser';
import { recordTypeDescriptions, getFieldAtPosition, recordFields, getFieldsForRecord } from './nachaFields';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Create status bar item
	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		100
	);
	context.subscriptions.push(statusBarItem);

	// Create diagnostic collection
	const diagnosticCollection = vscode.languages.createDiagnosticCollection('ach');
	context.subscriptions.push(diagnosticCollection);

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('nacha-file-parser.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from Nacha File Parser!');
	});

	context.subscriptions.push(disposable);

	const recordDecorations: Record<string, vscode.TextEditorDecorationType> = {
		'1': vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(244,67,54,0.12)' }),
		'5': vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(76,175,80,0.12)' }),
		'6': vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(33,150,243,0.12)' }),
		'7': vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(255,235,59,0.20)' }),
		'8': vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(156,39,176,0.12)' }),
		'9': vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(96,125,139,0.12)' })
	};
	Object.values(recordDecorations).forEach(d => context.subscriptions.push(d));

	// Batch-based row highlighting (alternate colors per batch)
	const batchRowPalette = [
		'rgba(247, 211, 161, 1)',
		'rgba(249, 241, 215, 1)'
	];
	const batchRowDecorations: vscode.TextEditorDecorationType[] = batchRowPalette.map(color =>
		vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			backgroundColor: color,
		})
	);
	batchRowDecorations.forEach(d => context.subscriptions.push(d));

	// Padding row decoration (for blocking/filler records)
	const paddingRowDecoration = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: 'rgba(200,200,200,0.08)',
		fontStyle: 'italic',
		opacity: '0.6'
	});
	context.subscriptions.push(paddingRowDecoration);

	// Virtual spacing decoration (adds visual separation between batches)
	const batchSeparatorDecoration = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		// backgroundColor: 'rgba(150,150,150,0.1)',
		borderWidth: '0 0 1px 0',
		borderStyle: 'solid',
		borderColor: 'rgba(100,100,100,0.4)'
	});
	context.subscriptions.push(batchSeparatorDecoration);

	// Field-level decorations (alternating colors for field boundaries)
	const fieldDecorationPalette = [
		'rgba(1, 87, 43, 1)',
		'rgba(93, 4, 246, 1)'
	];
	const fieldDecorations: vscode.TextEditorDecorationType[] = fieldDecorationPalette.map(color =>
		vscode.window.createTextEditorDecorationType({
			color: color,
		})
	);
	fieldDecorations.forEach(d => context.subscriptions.push(d));

	const runOnAch = (doc: vscode.TextDocument) => {
		if (doc.languageId !== 'ach') {
			return;
		}

		const text = doc.getText();

		// Update diagnostics
		const diagnostics: vscode.Diagnostic[] = [];
		const achDiags: AchDiagnostic[] = parseAch(text);
		for (const d of achDiags) {
			const range = new vscode.Range(
				new vscode.Position(d.line, d.start),
				new vscode.Position(d.line, d.end)
			);
			diagnostics.push(new vscode.Diagnostic(range, d.message, d.severity));
		}
		diagnosticCollection.set(doc.uri, diagnostics);

		// Update status bar
		const summary = parseAchSummary(text);
		statusBarItem.text = `$(file-code) Batches: ${summary.batches} $(list-ordered) Entries: ${summary.entries} $(symbol-numeric) Credits: $${summary.totalCredit.toFixed(2)} Debits: $${summary.totalDebit.toFixed(2)}`;
		statusBarItem.tooltip = `NACHA File Summary\n` +
			`Batches: ${summary.batches}\n` +
			`Entries: ${summary.entries}\n` +
			`Credits: $${summary.totalCredit.toFixed(2)}\n` +
			`Debits: $${summary.totalDebit.toFixed(2)}\n` +
			`Net Amount: $${(summary.totalCredit - summary.totalDebit).toFixed(2)}`;
		statusBarItem.show();
	};

	const applyAchDecorations = (editor: vscode.TextEditor) => {
		const doc = editor.document;
		const perTypeRanges: Record<string, vscode.Range[]> = { '1': [], '5': [], '6': [], '7': [], '8': [], '9': [] };
		const lineCount = doc.lineCount;
		for (let i = 0; i < lineCount; i++) {
			const line = doc.lineAt(i);
			const text = line.text;
			if (text.length === 0) { continue; }
			const t = text.charAt(0);
			if (perTypeRanges[t]) {
				perTypeRanges[t].push(line.range);
			}
		}
		for (const t of Object.keys(recordDecorations)) {
			editor.setDecorations(recordDecorations[t], perTypeRanges[t] || []);
		}
	};

	const applyBatchRowDecorations = (editor: vscode.TextEditor) => {
		const doc = editor.document;
		const lineCount = doc.lineCount;
		const perDecorationRanges: vscode.Range[][] = batchRowDecorations.map(() => []);
		const paddingRanges: vscode.Range[] = [];
		const separatorRanges: vscode.Range[] = [];
		let inBatch = false;
		let batchStart = -1;
		let batchIndex = 0;

		const isBatchRecord = (t: string) => t === '5' || t === '6' || t === '7' || t === '8';
		const isPaddingRow = (text: string) => text.length === 94 && /^9{94}$/.test(text);

		for (let i = 0; i < lineCount; i++) {
			const line = doc.lineAt(i);
			const text = line.text;
			if (text.length === 0) { continue; }

			// Check for padding rows
			if (isPaddingRow(text)) {
				paddingRanges.push(line.range);
				continue;
			}

			const t = text.charAt(0);

			// File header gets its own color
			if (t === '1') {
				const colorIdx = batchIndex % batchRowDecorations.length;
				perDecorationRanges[colorIdx].push(line.range);
				batchIndex++;
				continue;
			}

			if (t === '5' && !inBatch) {
				inBatch = true;
				batchStart = i;
				continue;
			}

			if (t === '8' && inBatch) {
				// finalize batch range from batchStart..i
				const colorIdx = batchIndex % batchRowDecorations.length;
				for (let j = batchStart; j <= i; j++) {
					perDecorationRanges[colorIdx].push(doc.lineAt(j).range);
				}
				// Add separator after batch control record
				separatorRanges.push(doc.lineAt(i).range);
				batchIndex++;
				inBatch = false;
				batchStart = -1;
				continue;
			}

			// File control (type 9) gets the current batch color
			if (t === '9') {
				const colorIdx = batchIndex % batchRowDecorations.length;
				perDecorationRanges[colorIdx].push(line.range);
				continue;
			}
		}

		// If file ends with an open batch (missing 8), highlight until last batch line
		if (inBatch && batchStart >= 0) {
			const colorIdx = batchIndex % batchRowDecorations.length;
			for (let j = batchStart; j < lineCount; j++) {
				const text = doc.lineAt(j).text;
				if (text.length === 0) { continue; }
				const t = text.charAt(0);
				if (!isBatchRecord(t)) { break; }
				perDecorationRanges[colorIdx].push(doc.lineAt(j).range);
			}
		}

		// Clear old per-type decorations and apply batch decorations
		for (const t of Object.keys(recordDecorations)) {
			editor.setDecorations(recordDecorations[t], []);
		}
		for (let idx = 0; idx < batchRowDecorations.length; idx++) {
			editor.setDecorations(batchRowDecorations[idx], perDecorationRanges[idx]);
		}
		editor.setDecorations(paddingRowDecoration, paddingRanges);
		editor.setDecorations(batchSeparatorDecoration, separatorRanges);
	};

	const applyFieldDecorations = (editor: vscode.TextEditor) => {
		const doc = editor.document;
		const lineCount = doc.lineCount;
		const perDecorationRanges: vscode.Range[][] = fieldDecorations.map(() => []);

		const isPaddingRow = (text: string) => text.length === 94 && /^9{94}$/.test(text);

		let currentSecCode = '';

		for (let i = 0; i < lineCount; i++) {
			const line = doc.lineAt(i);
			const text = line.text;
			if (text.length === 0 || isPaddingRow(text)) { continue; }

			const recordType = text.charAt(0);

			// Update SEC code context if we hit a Batch Header
			if (recordType === '5' && text.length >= 53) {
				currentSecCode = text.substring(50, 53).trim();
			} else if (recordType === '8' || recordType === '9' || recordType === '1') {
				// Reset or ignore SEC code for these
				if (recordType === '8') { currentSecCode = ''; }
			}

			const fields = getFieldsForContext(recordType, text, currentSecCode);

			if (!fields) { continue; }

			// Apply alternating colors to fields
			for (let fieldIdx = 0; fieldIdx < fields.length; fieldIdx++) {
				const field = fields[fieldIdx];
				const colorIdx = fieldIdx % fieldDecorations.length;
				const startPos = new vscode.Position(i, field.start);
				const endPos = new vscode.Position(i, Math.min(field.end, text.length));
				perDecorationRanges[colorIdx].push(new vscode.Range(startPos, endPos));
			}
		}

		for (let idx = 0; idx < fieldDecorations.length; idx++) {
			editor.setDecorations(fieldDecorations[idx], perDecorationRanges[idx]);
		}
	};

	// Helper to get fields based on context (local to applyFieldDecorations for now, or export if needed)
	const getFieldsForContext = (recordType: string, line: string, secCode: string) => {
		const dummyPos = 0;
		// Since getFieldAtPosition returns a single field, we need a way to get all fields.
		// Let's add an export to nachaFields or just use the same logic.
		// For now, I'll use a hacky way since the library doesn't export the field arrays directly as a function.
		// Actually, let's just use the exported recordFields/iatRecordFields/addendaIATFields but those are in nachaFields.ts
		// I will update nachaFields.ts to export a getFieldsForRecord function.
		return getFieldsForRecord(recordType, line, secCode);
	};

	const updateForEditor = () => {
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId === 'ach') {
			runOnAch(editor.document);
			applyBatchRowDecorations(editor);
			applyFieldDecorations(editor);
		} else {
			statusBarItem.hide();
			const ed = editor;
			if (ed) {
				for (const t of Object.keys(recordDecorations)) {
					ed.setDecorations(recordDecorations[t], []);
				}
				for (const d of batchRowDecorations) {
					ed.setDecorations(d, []);
				}
				ed.setDecorations(paddingRowDecoration, []);
				ed.setDecorations(batchSeparatorDecoration, []);
				for (const d of fieldDecorations) {
					ed.setDecorations(d, []);
				}
			}
		}
	};

	if (vscode.window.activeTextEditor) {
		updateForEditor();
	}

	// Register hover provider for ACH files
	const hoverProvider = vscode.languages.registerHoverProvider('ach', {
		provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
			const line = document.lineAt(position.line);
			const text = line.text;

			if (text.length === 0) {
				return undefined;
			}

			const recordType = text.charAt(0);
			const recordDesc = recordTypeDescriptions[recordType];

			if (!recordDesc) {
				return undefined;
			}

			// Check for padding row
			if (text.length === 94 && /^9{94}$/.test(text)) {
				return new vscode.Hover(
					new vscode.MarkdownString(
						`**Padding Record**\n\nBlocking/filler record used to pad file to required block size (multiple of 10 records).`
					)
				);
			}

			let secCode = '';
			if (['5', '6', '7', '8'].includes(recordType)) {
				// Find the last batch header to get SEC code
				for (let i = position.line; i >= 0; i--) {
					const l = document.lineAt(i).text;
					if (l.charAt(0) === '5' && l.length >= 53) {
						secCode = l.substring(50, 53).trim();
						break;
					}
					if (l.charAt(0) === '1') { break; } // Stopped at file header
				}
			}

			const field = getFieldAtPosition(recordType, position.character, text, secCode);

			if (!field) {
				// Show record type info if not over a specific field
				return new vscode.Hover(
					new vscode.MarkdownString(`**${recordDesc}**${secCode ? ` (${secCode})` : ''}`)
				);
			}

			// Build hover content with field details
			const value = text.substring(field.start, field.end).trim();
			const markdown = new vscode.MarkdownString();
			markdown.appendMarkdown(`**${field.name}**\n\n`);
			markdown.appendMarkdown(`${field.description}\n\n`);
			markdown.appendMarkdown(`---\n\n`);
			markdown.appendMarkdown(`**Position:** ${field.start + 1}-${field.end} (${field.end - field.start} chars)\n\n`);
			if (value) {
				markdown.appendCodeblock(value, 'text');
			}

			// Create range for the specific field to highlight only that field
			const fieldRange = new vscode.Range(
				new vscode.Position(position.line, field.start),
				new vscode.Position(position.line, field.end)
			);

			return new vscode.Hover(markdown, fieldRange);
		}
	});
	context.subscriptions.push(hoverProvider);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(doc => {
			if (doc.languageId === 'ach') {
				updateForEditor();
			}
		}),
		vscode.window.onDidChangeActiveTextEditor(() => updateForEditor()),
		vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.languageId === 'ach') {
				updateForEditor();
			}
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
