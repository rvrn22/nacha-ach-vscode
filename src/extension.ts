// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { parseAch, parseAchSummary, type AchDiagnostic } from './nachaParser';
import { getAchFieldAtPosition, parseAchDocument, type AchDocument } from './achDocument';
import { recordTypeDescriptions } from './nachaFields';

type AchAnalysis = {
	version: number;
	document: AchDocument;
	diagnostics: AchDiagnostic[];
	summary: ReturnType<typeof parseAchSummary>;
};

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

	const analysisCache = new Map<string, AchAnalysis>();
	const getAnalysis = (doc: vscode.TextDocument): AchAnalysis => {
		const key = doc.uri.toString();
		const cached = analysisCache.get(key);
		if (cached?.version === doc.version) {
			return cached;
		}

		const achDocument = parseAchDocument(doc.getText());
		const analysis: AchAnalysis = {
			version: doc.version,
			document: achDocument,
			diagnostics: parseAch(achDocument),
			summary: parseAchSummary(achDocument),
		};
		analysisCache.set(key, analysis);
		return analysis;
	};

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('nacha-file-parser.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from Nacha File Parser!');
	});

	context.subscriptions.push(disposable);


	// Decorations are created dynamically so they can adapt to light/dark themes.
	let recordDecorations: Record<string, vscode.TextEditorDecorationType> = {} as Record<string, vscode.TextEditorDecorationType>;
	let batchRowDecorations: vscode.TextEditorDecorationType[] = [];
	let paddingRowDecoration: vscode.TextEditorDecorationType | undefined;
	let batchSeparatorDecoration: vscode.TextEditorDecorationType | undefined;
	let fieldDecorations: vscode.TextEditorDecorationType[] = [];

	const disposeDecorations = () => {
		Object.values(recordDecorations).forEach(d => d && d.dispose());
		batchRowDecorations.forEach(d => d && d.dispose());
		fieldDecorations.forEach(d => d && d.dispose());
		if (paddingRowDecoration) { paddingRowDecoration.dispose(); }
		if (batchSeparatorDecoration) { batchSeparatorDecoration.dispose(); }
		recordDecorations = {} as Record<string, vscode.TextEditorDecorationType>;
		batchRowDecorations = [];
		fieldDecorations = [];
		paddingRowDecoration = undefined;
		batchSeparatorDecoration = undefined;
	};

	const createDecorationsForTheme = (themeKind: vscode.ColorThemeKind) => {
		// Choose palettes tuned for light vs dark themes
		const isDark = themeKind === vscode.ColorThemeKind.Dark || themeKind === vscode.ColorThemeKind.HighContrast;

		const recordPalette: Record<'1'|'5'|'6'|'7'|'8'|'9', string> = isDark ? {
			'1': 'rgba(244,67,54,0.28)',
			'5': 'rgba(76,175,80,0.28)',
			'6': 'rgba(33,150,243,0.28)',
			'7': 'rgba(255,235,59,0.20)',
			'8': 'rgba(156,39,176,0.28)',
			'9': 'rgba(128,138,143,0.14)'
		} : {
			'1': 'rgba(244,67,54,0.12)',
			'5': 'rgba(76,175,80,0.12)',
			'6': 'rgba(33,150,243,0.12)',
			'7': 'rgba(255,235,59,0.16)',
			'8': 'rgba(156,39,176,0.12)',
			'9': 'rgba(96,125,139,0.08)'
		};

		const batchRowPalette = isDark ? [
			'rgba(70,44,25,0.20)',
			'rgba(48,50,54,0.16)'
		] : [
			'rgba(247,211,161,0.14)',
			'rgba(249,241,215,0.12)'
		];

		const fieldPalette = isDark ? [
			'rgba(102,187,106,1)',
			'rgba(149,117,205,1)'
		] : [
			'rgba(1,87,43,1)',
			'rgba(93,4,246,1)'
		];

		// Dispose any previous decorations
		disposeDecorations();

		// Create record decorations
		const recordKeys = ['1','5','6','7','8','9'] as const;
		for (const k of recordKeys) {
			recordDecorations[k] = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: recordPalette[k] });
			context.subscriptions.push(recordDecorations[k]);
		}

		// Batch row decorations with left accent border to visually group batches
		const borderFromBg = (bg: string, alpha = 0.45) => {
			const m = bg.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)/);
			if (!m) { return bg; }
			return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
		};
		batchRowDecorations = batchRowPalette.map(color => {
			const borderColor = borderFromBg(color, isDark ? 0.6 : 0.44);
			return vscode.window.createTextEditorDecorationType({
				isWholeLine: true,
				backgroundColor: color,
				borderWidth: '0 0 0 4px',
				borderStyle: 'solid',
				borderColor,
			});
		});
		batchRowDecorations.forEach(d => context.subscriptions.push(d));

		// Padding row
		paddingRowDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(200,200,200,0.06)', fontStyle: 'italic', opacity: '0.7' });
		context.subscriptions.push(paddingRowDecoration);

		// Batch separator
		batchSeparatorDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, borderWidth: '0 0 1px 0', borderStyle: 'solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(100,100,100,0.22)' });
		context.subscriptions.push(batchSeparatorDecoration);

		// Field decorations
		fieldDecorations = fieldPalette.map(color => vscode.window.createTextEditorDecorationType({ color }));
		fieldDecorations.forEach(d => context.subscriptions.push(d));
	};

	// Initialize decorations for current theme
	createDecorationsForTheme(vscode.window.activeColorTheme.kind);

	// Recreate decorations when theme changes so colors adapt to light/dark
	vscode.window.onDidChangeActiveColorTheme(e => {
		createDecorationsForTheme(e.kind);
		updateForEditor();
	});

	const runOnAch = (doc: vscode.TextDocument) => {
		if (doc.languageId !== 'ach') {
			return;
		}

		const analysis = getAnalysis(doc);

		// Update diagnostics
		const diagnostics: vscode.Diagnostic[] = [];
		for (const d of analysis.diagnostics) {
			const range = new vscode.Range(
				new vscode.Position(d.line, d.start),
				new vscode.Position(d.line, d.end)
			);
			diagnostics.push(new vscode.Diagnostic(range, d.message, d.severity));
		}
		diagnosticCollection.set(doc.uri, diagnostics);

		// Update status bar
		const summary = analysis.summary;
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
		const achDocument = getAnalysis(doc).document;
		const perDecorationRanges: vscode.Range[][] = batchRowDecorations.map(() => []);
		const paddingRanges: vscode.Range[] = [];
		const separatorRanges: vscode.Range[] = [];

		for (const header of achDocument.fileHeaders) {
			perDecorationRanges[0].push(doc.lineAt(header.line).range);
		}

		for (let batchIndex = 0; batchIndex < achDocument.batches.length; batchIndex++) {
			const batch = achDocument.batches[batchIndex];
			const colorIdx = (batchIndex + 1) % batchRowDecorations.length;
			for (const record of batch.records) {
				perDecorationRanges[colorIdx].push(doc.lineAt(record.line).range);
			}
			if (batch.control) {
				separatorRanges.push(doc.lineAt(batch.control.line).range);
			}
		}

		const controlColorIdx = (achDocument.batches.length + 1) % batchRowDecorations.length;
		for (const control of achDocument.fileControls) {
			perDecorationRanges[controlColorIdx].push(doc.lineAt(control.line).range);
		}
		for (const padding of achDocument.paddingRecords) {
			paddingRanges.push(doc.lineAt(padding.line).range);
		}

		// Clear old per-type decorations and apply batch decorations
		for (const t of Object.keys(recordDecorations)) {
			editor.setDecorations(recordDecorations[t], []);
		}
		for (let idx = 0; idx < batchRowDecorations.length; idx++) {
			editor.setDecorations(batchRowDecorations[idx], perDecorationRanges[idx]);
		}
		editor.setDecorations(paddingRowDecoration!, paddingRanges);
		editor.setDecorations(batchSeparatorDecoration!, separatorRanges);
	};

	const applyFieldDecorations = (editor: vscode.TextEditor) => {
		const doc = editor.document;
		const achDocument = getAnalysis(doc).document;
		const perDecorationRanges: vscode.Range[][] = fieldDecorations.map(() => []);

		for (const record of achDocument.records) {
			if (record.kind === 'padding') { continue; }
			// Apply alternating colors to fields
			for (let fieldIdx = 0; fieldIdx < record.fields.length; fieldIdx++) {
				const field = record.fields[fieldIdx];
				if (field.start >= record.raw.length) { continue; }
				const colorIdx = fieldIdx % fieldDecorations.length;
				const startPos = new vscode.Position(record.line, field.start);
				const endPos = new vscode.Position(record.line, Math.min(field.end, record.raw.length));
				perDecorationRanges[colorIdx].push(new vscode.Range(startPos, endPos));
			}
		}

		for (let idx = 0; idx < fieldDecorations.length; idx++) {
			editor.setDecorations(fieldDecorations[idx], perDecorationRanges[idx]);
		}
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
				ed.setDecorations(paddingRowDecoration!, []);
				ed.setDecorations(batchSeparatorDecoration!, []);
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
			const record = getAnalysis(document).document.recordByLine.get(position.line);
			if (!record) {
				return undefined;
			}

			const recordDesc = recordTypeDescriptions[record.recordType];

			if (!recordDesc && record.kind !== 'padding') {
				return undefined;
			}

			// Check for padding row
			if (record.kind === 'padding') {
				return new vscode.Hover(
					new vscode.MarkdownString(
						`**Padding Record**\n\nBlocking/filler record used to pad file to required block size (multiple of 10 records).`
					)
				);
			}

			const field = getAchFieldAtPosition(record, position.character);

			if (!field) {
				// Show record type info if not over a specific field
				return new vscode.Hover(
					new vscode.MarkdownString(`**${recordDesc}**${record.secCode ? ` (${record.secCode})` : ''}`)
				);
			}

			// Build hover content with field details
			const value = field.value;
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
		}),
		vscode.workspace.onDidCloseTextDocument(doc => analysisCache.delete(doc.uri.toString()))
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
