// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {
	formatAchCents,
	parseAch,
	parseAchSummary,
	resolveAchValidationProfile,
	validationProfileSignature,
	type AchDiagnostic,
	type AchValidationProfile,
} from './nachaParser';
import type { AchCustomProfileDefinition } from './achProfiles';
import { getAchFieldAtPosition, parseAchDocument, type AchDocument } from './achDocument';
import { AchExplorerProvider } from './achExplorer';
import {
	AchCodeActionProvider,
	AchFixPreviewProvider,
	previewAndApplyAchEdits,
} from './achCodeActions';
import { buildSequenceRenumberEdits, collectAchFixEdits } from './achFixes';
import {
	AchDocumentSymbolProvider,
	AchFoldingRangeProvider,
	AchInlayHintsProvider,
	findMatchingAchRange,
	findRelatedAchRanges,
	toVscodeRanges,
} from './achNavigation';
import { recordTypeDescriptions } from './nachaFields';
import { createAchJsonReport, createAchSarifReport, serializeAchReport } from './achReporting';
import { detectAchContent } from './achDetection';

type AchAnalysis = {
	version: number;
	profileSignature: string;
	profile: AchValidationProfile;
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
	const fieldStatusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100
	);
	context.subscriptions.push(fieldStatusBarItem);

	// Create diagnostic collection
	const diagnosticCollection = vscode.languages.createDiagnosticCollection('ach');
	context.subscriptions.push(diagnosticCollection);

	const explorerProvider = new AchExplorerProvider();
	const explorerView = vscode.window.createTreeView('nacha-file-parser.decodedExplorer', {
		treeDataProvider: explorerProvider,
		showCollapseAll: true,
	});
	context.subscriptions.push(explorerView);

	const analysisCache = new Map<string, AchAnalysis>();
	const documentUpdateTimers = new Map<string, NodeJS.Timeout>();
	const detectionOffered = new Set<string>();
	const offerAchLanguageMode = async (doc: vscode.TextDocument) => {
		const configuration = vscode.workspace.getConfiguration('nachaFileParser', doc.uri);
		if (!configuration.get<boolean>('detectAchInTextFiles', true)) { return; }
		if (doc.languageId !== 'plaintext' || !doc.uri.path.toLowerCase().endsWith('.txt')) { return; }
		const key = doc.uri.toString();
		if (detectionOffered.has(key)) { return; }
		const detection = detectAchContent(doc.getText());
		if (!detection.isLikelyAch) { return; }
		detectionOffered.add(key);
		const choice = await vscode.window.showInformationMessage(
			`This text file looks like a NACHA ACH file (${Math.round(detection.confidence * 100)}% confidence).`,
			'Open as ACH',
			'Not Now',
		);
		if (choice === 'Open as ACH') {
			await vscode.languages.setTextDocumentLanguage(doc, 'ach');
		}
	};
	const getAnalysis = (doc: vscode.TextDocument): AchAnalysis => {
		const key = doc.uri.toString();
		const configuration = vscode.workspace.getConfiguration('nachaFileParser', doc.uri);
		const profileSetting = configuration.get<string>('validationProfile', 'nacha');
		const customProfiles = configuration.get<Record<string, AchCustomProfileDefinition>>('validationProfiles', {});
		const ruleOverrides = configuration.get<Record<string, unknown>>('ruleOverrides', {});
		const profile = resolveAchValidationProfile(profileSetting, customProfiles, ruleOverrides);
		const profileSignature = validationProfileSignature(profile);
		const cached = analysisCache.get(key);
		if (cached?.version === doc.version && cached.profileSignature === profileSignature) {
			return cached;
		}

		const achDocument = parseAchDocument(doc.getText());
		const analysis: AchAnalysis = {
			version: doc.version,
			profileSignature,
			profile,
			document: achDocument,
			diagnostics: parseAch(achDocument, profile),
			summary: parseAchSummary(achDocument),
		};
		analysisCache.set(key, analysis);
		return analysis;
	};

	const symbolProvider = new AchDocumentSymbolProvider(doc => getAnalysis(doc).document);
	const foldingProvider = new AchFoldingRangeProvider(doc => getAnalysis(doc).document);
	const inlayHintsProvider = new AchInlayHintsProvider(doc => getAnalysis(doc).document);
	const codeActionProvider = new AchCodeActionProvider(doc => getAnalysis(doc));
	const fixPreviewProvider = new AchFixPreviewProvider();
	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider('ach', symbolProvider),
		vscode.languages.registerFoldingRangeProvider('ach', foldingProvider),
		vscode.languages.registerInlayHintsProvider('ach', inlayHintsProvider),
		vscode.languages.registerCodeActionsProvider('ach', codeActionProvider, {
			providedCodeActionKinds: AchCodeActionProvider.providedCodeActionKinds,
		}),
		vscode.workspace.registerTextDocumentContentProvider('ach-fix-preview', fixPreviewProvider),
	);

	const disposable = vscode.commands.registerCommand('nacha-file-parser.showFileSummary', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'ach') {
			void vscode.window.showInformationMessage('Open an ACH file to view its summary.');
			return;
		}
		const analysis = getAnalysis(editor.document);
		const errors = analysis.diagnostics.filter(diagnostic => diagnostic.severity === 0).length;
		const warnings = analysis.diagnostics.filter(diagnostic => diagnostic.severity === 1).length;
		await vscode.window.showQuickPick([
			{ label: '$(layers) Batches', description: String(analysis.summary.batches) },
			{ label: '$(list-ordered) Entries', description: String(analysis.summary.entries) },
			{ label: '$(discard) Reversal Batches', description: String(analysis.summary.reversalBatches) },
			{ label: '$(arrow-swap) Reversal Entries', description: String(analysis.summary.reversalEntries) },
			{ label: '$(preview) Prenotification Entries', description: String(analysis.summary.prenoteEntries) },
			{ label: '$(arrow-up) Credits', description: `$${formatAchCents(analysis.summary.totalCreditCents)}` },
			{ label: '$(arrow-down) Debits', description: `$${formatAchCents(analysis.summary.totalDebitCents)}` },
			{ label: '$(diff) Net Amount', description: `$${formatAchCents(analysis.summary.netAmountCents)}` },
			{ label: '$(error) Errors', description: String(errors) },
			{ label: '$(warning) Warnings', description: String(warnings) },
			{ label: '$(settings) Profile', description: analysis.profile.displayName },
			{ label: '$(versions) Ruleset', description: analysis.profile.rulesVersion },
		], { title: 'ACH File Summary', placeHolder: 'Summary values are read-only' });
	});

	context.subscriptions.push(disposable);
	const revealEditorRange = async (uri: vscode.Uri, range: vscode.Range) => {
		const document = await vscode.workspace.openTextDocument(uri);
		const editor = await vscode.window.showTextDocument(document, { preview: false });
		editor.selection = new vscode.Selection(range.start, range.end);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	};
	const navigateProblem = async (direction: 1 | -1) => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'ach') { return; }
		const diagnostics = [...getAnalysis(editor.document).diagnostics]
			.sort((left, right) => left.line - right.line || left.start - right.start);
		if (diagnostics.length === 0) {
			void vscode.window.showInformationMessage('No ACH validation problems found.');
			return;
		}
		const position = editor.selection.active;
		const currentOffset = position.line * 1000 + position.character;
		const diagnostic = direction === 1
			? diagnostics.find(item => item.line * 1000 + item.start > currentOffset) ?? diagnostics[0]
			: [...diagnostics].reverse().find(item => item.line * 1000 + item.start < currentOffset) ?? diagnostics.at(-1)!;
		await revealEditorRange(
			editor.document.uri,
			new vscode.Range(diagnostic.line, diagnostic.start, diagnostic.line, diagnostic.end),
		);
	};
	const runPreviewedFixes = async (kind: 'derived' | 'all' | 'sequences') => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'ach') { return; }
		const analysis = getAnalysis(editor.document);
		const edits = kind === 'sequences'
			? buildSequenceRenumberEdits(analysis.document)
			: collectAchFixEdits(analysis.document, analysis.diagnostics, kind);
		const title = kind === 'derived'
			? 'Recalculate ACH Derived Fields'
			: kind === 'sequences'
				? 'Renumber ACH Sequences'
				: 'Apply All Safe ACH Fixes';
		await previewAndApplyAchEdits(editor.document, edits, title, fixPreviewProvider);
	};
	const exportValidationReport = async (format: 'json' | 'sarif') => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'ach') { return; }
		const analysis = getAnalysis(editor.document);
		const fileName = editor.document.uri.path.split('/').at(-1) || 'ach-file';
		const reportInput = {
			fileName,
			document: analysis.document,
			diagnostics: analysis.diagnostics,
			summary: analysis.summary,
			profile: analysis.profile,
		};
		const report = format === 'sarif' ? createAchSarifReport(reportInput) : createAchJsonReport(reportInput);
		const extension = format === 'sarif' ? 'sarif' : 'validation.json';
		const destination = await vscode.window.showSaveDialog({
			defaultUri: editor.document.uri.with({ path: `${editor.document.uri.path}.${extension}` }),
			filters: format === 'sarif' ? { SARIF: ['sarif'] } : { JSON: ['json'] },
			saveLabel: `Export Redacted ${format.toUpperCase()} Report`,
		});
		if (!destination) { return; }
		await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(serializeAchReport(report)));
		void vscode.window.showInformationMessage(`Redacted ACH validation report saved to ${destination.fsPath || destination.path}.`);
	};
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'nacha-file-parser.revealRange',
			async (uri: vscode.Uri, line: number, start: number, end: number) => {
				await revealEditorRange(uri, new vscode.Range(line, start, line, end));
			},
		),
		vscode.commands.registerCommand('nacha-file-parser.goToMatchingRecord', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== 'ach') { return; }
			const target = findMatchingAchRange(getAnalysis(editor.document).document, editor.selection.active.line);
			if (!target) {
				void vscode.window.showInformationMessage('This ACH record has no matching header, control, entry, or addenda record.');
				return;
			}
			await revealEditorRange(editor.document.uri, new vscode.Range(target.line, target.start, target.line, target.end));
		}),
		vscode.commands.registerCommand('nacha-file-parser.nextProblem', () => navigateProblem(1)),
		vscode.commands.registerCommand('nacha-file-parser.previousProblem', () => navigateProblem(-1)),
		vscode.commands.registerCommand('nacha-file-parser.recalculateDerivedFields', () => runPreviewedFixes('derived')),
		vscode.commands.registerCommand('nacha-file-parser.applyAllSafeFixes', () => runPreviewedFixes('all')),
		vscode.commands.registerCommand('nacha-file-parser.renumberSequences', () => runPreviewedFixes('sequences')),
		vscode.commands.registerCommand('nacha-file-parser.exportJsonReport', () => exportValidationReport('json')),
		vscode.commands.registerCommand('nacha-file-parser.exportSarifReport', () => exportValidationReport('sarif')),
		vscode.commands.registerCommand('nacha-file-parser.refreshExplorer', () => {
			analysisCache.clear();
			updateForEditor();
		}),
	);


	// Decorations are created dynamically so they can adapt to light/dark themes.
	let recordDecorations: Record<string, vscode.TextEditorDecorationType> = {} as Record<string, vscode.TextEditorDecorationType>;
	let batchRowDecorations: vscode.TextEditorDecorationType[] = [];
	let paddingRowDecoration: vscode.TextEditorDecorationType | undefined;
	let batchSeparatorDecoration: vscode.TextEditorDecorationType | undefined;
	let fieldDecorations: vscode.TextEditorDecorationType[] = [];
	let columnRulerDecoration: vscode.TextEditorDecorationType | undefined;
	let relatedFieldDecoration: vscode.TextEditorDecorationType | undefined;
	let recordLabelDecorations: Record<string, vscode.TextEditorDecorationType> = {};
	let paddingLabelDecoration: vscode.TextEditorDecorationType | undefined;

	const disposeDecorations = () => {
		Object.values(recordDecorations).forEach(d => d && d.dispose());
		batchRowDecorations.forEach(d => d && d.dispose());
		fieldDecorations.forEach(d => d && d.dispose());
		if (paddingRowDecoration) { paddingRowDecoration.dispose(); }
		if (batchSeparatorDecoration) { batchSeparatorDecoration.dispose(); }
		if (columnRulerDecoration) { columnRulerDecoration.dispose(); }
		if (relatedFieldDecoration) { relatedFieldDecoration.dispose(); }
		Object.values(recordLabelDecorations).forEach(decoration => decoration.dispose());
		if (paddingLabelDecoration) { paddingLabelDecoration.dispose(); }
		recordDecorations = {} as Record<string, vscode.TextEditorDecorationType>;
		batchRowDecorations = [];
		fieldDecorations = [];
		paddingRowDecoration = undefined;
		batchSeparatorDecoration = undefined;
		columnRulerDecoration = undefined;
		relatedFieldDecoration = undefined;
		recordLabelDecorations = {};
		paddingLabelDecoration = undefined;
	};

	const createDecorationsForTheme = (themeKind: vscode.ColorThemeKind) => {
		// Choose palettes tuned for light vs dark themes
		const isDark = themeKind === vscode.ColorThemeKind.Dark || themeKind === vscode.ColorThemeKind.HighContrast;
		const isHighContrast = themeKind === vscode.ColorThemeKind.HighContrast || themeKind === vscode.ColorThemeKind.HighContrastLight;
		const configuration = vscode.workspace.getConfiguration('nachaFileParser');

		const defaultRecordPalette: Record<'1'|'5'|'6'|'7'|'8'|'9', string> = isDark ? {
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
		const recordPalette = {
			...defaultRecordPalette,
			...configuration.get<Partial<typeof defaultRecordPalette>>('recordTypeColors', {}),
		};

		const defaultBatchRowPalette = isDark ? [
			'rgba(70,44,25,0.20)',
			'rgba(48,50,54,0.16)'
		] : [
			'rgba(247,211,161,0.14)',
			'rgba(249,241,215,0.12)'
		];
		const configuredBatchColors = configuration.get<string[]>('batchRowColors', []);
		const batchRowPalette = configuredBatchColors.length >= 2 ? configuredBatchColors : defaultBatchRowPalette;

		const defaultFieldPalette = isDark ? [
			'rgba(102,187,106,1)',
			'rgba(149,117,205,1)'
		] : [
			'rgba(1,87,43,1)',
			'rgba(93,4,246,1)'
		];
		const configuredFieldColors = configuration.get<string[]>('fieldColors', []);
		const fieldPalette = configuredFieldColors.length >= 2 ? configuredFieldColors : defaultFieldPalette;
		const accessibleFieldBoundaries = isHighContrast || configuration.get<boolean>('accessibleFieldBoundaries', false);

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
		const configuredPaddingColor = configuration.get<string | null>('paddingRowColor', null);
		paddingRowDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: configuredPaddingColor || (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(200,200,200,0.06)'), fontStyle: 'italic', opacity: '0.7' });
		context.subscriptions.push(paddingRowDecoration);

		// Batch separator
		batchSeparatorDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, borderWidth: '0 0 1px 0', borderStyle: 'solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(100,100,100,0.22)' });
		context.subscriptions.push(batchSeparatorDecoration);

		// Field decorations
		fieldDecorations = fieldPalette.map((color, index) => vscode.window.createTextEditorDecorationType({
			color,
			textDecoration: accessibleFieldBoundaries && index % 2 === 0 ? 'underline dotted' : undefined,
		}));
		fieldDecorations.forEach(d => context.subscriptions.push(d));

		columnRulerDecoration = vscode.window.createTextEditorDecorationType({
			borderWidth: '0 1px 0 0',
			borderStyle: 'solid',
			borderColor: isDark ? 'rgba(255,255,255,0.38)' : 'rgba(40,40,40,0.38)',
		});
		relatedFieldDecoration = vscode.window.createTextEditorDecorationType({
			backgroundColor: isDark ? 'rgba(255,193,7,0.24)' : 'rgba(255,193,7,0.30)',
			borderWidth: '0 0 1px 0',
			borderStyle: 'solid',
			borderColor: isDark ? 'rgba(255,213,79,0.85)' : 'rgba(180,120,0,0.85)',
		});
		context.subscriptions.push(columnRulerDecoration, relatedFieldDecoration);

		const recordLabels: Record<string, string> = {
			'1': 'File Header',
			'5': 'Batch Header',
			'6': 'Entry Detail',
			'7': 'Addenda',
			'8': 'Batch Control',
			'9': 'File Control',
		};
		for (const [type, label] of Object.entries(recordLabels)) {
			recordLabelDecorations[type] = vscode.window.createTextEditorDecorationType({
				after: { contentText: `  ← ${label}`, color: new vscode.ThemeColor('descriptionForeground'), fontStyle: 'italic' },
			});
			context.subscriptions.push(recordLabelDecorations[type]);
		}
		paddingLabelDecoration = vscode.window.createTextEditorDecorationType({
			after: { contentText: '  ← Padding', color: new vscode.ThemeColor('descriptionForeground'), fontStyle: 'italic' },
		});
		context.subscriptions.push(paddingLabelDecoration);
	};

	// Initialize decorations for current theme
	createDecorationsForTheme(vscode.window.activeColorTheme.kind);

	// Recreate decorations when theme changes so colors adapt to light/dark
	context.subscriptions.push(
		vscode.window.onDidChangeActiveColorTheme(e => {
			createDecorationsForTheme(e.kind);
			updateForEditor();
		}),
	);

	const runOnAch = (doc: vscode.TextDocument): AchAnalysis | undefined => {
		if (doc.languageId !== 'ach') {
			return undefined;
		}

		const analysis = getAnalysis(doc);

		// Update diagnostics
		const diagnostics: vscode.Diagnostic[] = [];
		const maxDiagnostics = Math.max(1, vscode.workspace.getConfiguration('nachaFileParser', doc.uri).get<number>('maxDiagnostics', 1000));
		for (const d of analysis.diagnostics.slice(0, maxDiagnostics)) {
			const range = new vscode.Range(
				new vscode.Position(d.line, d.start),
				new vscode.Position(d.line, d.end)
			);
			const diagnosticMessage = d.overrideReason ? `${d.message} (Override: ${d.overrideReason})` : d.message;
			const diagnostic = new vscode.Diagnostic(range, diagnosticMessage, d.severity);
			diagnostic.source = `NACHA · ${d.category}`;
			diagnostic.code = d.code;
			if (d.related?.length) {
				diagnostic.relatedInformation = d.related.map(item => new vscode.DiagnosticRelatedInformation(
					new vscode.Location(
						doc.uri,
						new vscode.Range(item.line, item.start, item.line, item.end),
					),
					item.message,
				));
			}
			diagnostics.push(diagnostic);
		}
		if (analysis.diagnostics.length > maxDiagnostics) {
			const omitted = analysis.diagnostics.length - maxDiagnostics;
			const diagnostic = new vscode.Diagnostic(
				new vscode.Range(0, 0, 0, 1),
				`${omitted} additional ACH diagnostics omitted from Problems for performance. Export a report or use the CLI for the complete result.`,
				vscode.DiagnosticSeverity.Information,
			);
			diagnostic.source = 'NACHA · performance';
			diagnostic.code = 'ACH-UI-DIAGNOSTIC-LIMIT';
			diagnostics.push(diagnostic);
		}
		diagnosticCollection.set(doc.uri, diagnostics);

		// Update status bar
		const summary = analysis.summary;
		statusBarItem.text = `$(file-code) Batches: ${summary.batches} $(list-ordered) Entries: ${summary.entries} $(symbol-numeric) Credits: $${formatAchCents(summary.totalCreditCents)} Debits: $${formatAchCents(summary.totalDebitCents)}`;
		statusBarItem.tooltip = `NACHA File Summary\n` +
			`Batches: ${summary.batches}\n` +
			`Entries: ${summary.entries}\n` +
			`Credits: $${formatAchCents(summary.totalCreditCents)}\n` +
			`Debits: $${formatAchCents(summary.totalDebitCents)}\n` +
			`Net Amount: $${formatAchCents(summary.netAmountCents)}`;
		statusBarItem.show();
		return analysis;
	};

	const applyAchDecorations = (editor: vscode.TextEditor) => {
		const doc = editor.document;
		const perTypeRanges: Record<string, vscode.Range[]> = { '1': [], '5': [], '6': [], '7': [], '8': [], '9': [] };
		const paddingRanges: vscode.Range[] = [];
		const lineCount = doc.lineCount;
		for (let i = 0; i < lineCount; i++) {
			const line = doc.lineAt(i);
			const text = line.text;
			if (text.length === 0) { continue; }
			if (/^9{94}$/.test(text)) {
				paddingRanges.push(line.range);
				continue;
			}
			const t = text.charAt(0);
			if (perTypeRanges[t]) {
				perTypeRanges[t].push(line.range);
			}
		}
		for (const t of Object.keys(recordDecorations)) {
			editor.setDecorations(recordDecorations[t], perTypeRanges[t] || []);
		}
		for (const decoration of batchRowDecorations) { editor.setDecorations(decoration, []); }
		editor.setDecorations(batchSeparatorDecoration!, []);
		editor.setDecorations(paddingRowDecoration!, paddingRanges);
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

		const visibleRanges = editor.visibleRanges;
		const visibleLine = (line: number) => visibleRanges.length === 0 || visibleRanges.some(range =>
			line >= Math.max(0, range.start.line - 25) && line <= range.end.line + 25,
		);
		for (const record of achDocument.records) {
			if (!visibleLine(record.line)) { continue; }
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

	const applyColumnRuler = (editor: vscode.TextEditor) => {
		const enabled = vscode.workspace.getConfiguration('nachaFileParser', editor.document.uri).get<boolean>('showColumnRuler', true);
		if (!enabled) {
			editor.setDecorations(columnRulerDecoration!, []);
			return;
		}
		const ranges = getAnalysis(editor.document).document.records
			.filter(record => record.raw.length >= 94)
			.map(record => new vscode.Range(record.line, 93, record.line, 94));
		editor.setDecorations(columnRulerDecoration!, ranges);
	};

	const applyRecordLabels = (editor: vscode.TextEditor) => {
		const enabled = vscode.workspace.getConfiguration('nachaFileParser', editor.document.uri).get<boolean>('showRecordTypeLabels', true);
		const rangesByType: Record<string, vscode.Range[]> = {};
		for (const type of Object.keys(recordLabelDecorations)) { rangesByType[type] = []; }
		const paddingRanges: vscode.Range[] = [];
		if (enabled) {
			const visibleRanges = editor.visibleRanges;
			const visibleLine = (line: number) => visibleRanges.length === 0 || visibleRanges.some(range =>
				line >= Math.max(0, range.start.line - 25) && line <= range.end.line + 25,
			);
			for (const record of getAnalysis(editor.document).document.records) {
				if (!visibleLine(record.line)) { continue; }
				const range = editor.document.lineAt(record.line).range;
				if (record.kind === 'padding') { paddingRanges.push(range); }
				else if (rangesByType[record.recordType]) { rangesByType[record.recordType].push(range); }
			}
		}
		for (const [type, decoration] of Object.entries(recordLabelDecorations)) {
			editor.setDecorations(decoration, rangesByType[type]);
		}
		editor.setDecorations(paddingLabelDecoration!, paddingRanges);
	};

	const updateCursorContext = (editor: vscode.TextEditor) => {
		if (editor.document.languageId !== 'ach') {
			fieldStatusBarItem.hide();
			return;
		}
		const position = editor.selection.active;
		const achDocument = getAnalysis(editor.document).document;
		const record = achDocument.recordByLine.get(position.line);
		const field = record ? getAchFieldAtPosition(record, position.character) : undefined;
		fieldStatusBarItem.text = `$(ruler) ACH Col ${position.character + 1}/94${field ? ` · ${field.name}` : ''}`;
		fieldStatusBarItem.tooltip = field
			? `${field.description}\nPositions ${field.start + 1}-${field.end}`
			: 'Current fixed-width ACH column';
		fieldStatusBarItem.show();

		const relatedRanges = findRelatedAchRanges(achDocument, position.line, position.character);
		editor.setDecorations(relatedFieldDecoration!, toVscodeRanges(relatedRanges));
	};

	const updateForEditor = () => {
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId === 'ach') {
			const analysis = runOnAch(editor.document);
			const rowColoring = vscode.workspace.getConfiguration('nachaFileParser', editor.document.uri).get<string>('rowColoring', 'batches');
			if (rowColoring === 'recordTypes') { applyAchDecorations(editor); }
			else { applyBatchRowDecorations(editor); }
			applyFieldDecorations(editor);
			applyColumnRuler(editor);
			applyRecordLabels(editor);
			updateCursorContext(editor);
			if (analysis) {
				const configuration = vscode.workspace.getConfiguration('nachaFileParser', editor.document.uri);
				const maskSensitiveValues = configuration.get<boolean>('maskSensitiveValues', true);
				const explorerEntryLimit = configuration.get<number>('explorerEntryLimit', 1000);
				explorerProvider.update(editor.document.uri, analysis.document, analysis.diagnostics, analysis.summary, maskSensitiveValues, explorerEntryLimit);
			}
		} else {
			statusBarItem.hide();
			fieldStatusBarItem.hide();
			explorerProvider.clear();
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
				ed.setDecorations(columnRulerDecoration!, []);
				ed.setDecorations(relatedFieldDecoration!, []);
				for (const decoration of Object.values(recordLabelDecorations)) { ed.setDecorations(decoration, []); }
				ed.setDecorations(paddingLabelDecoration!, []);
			}
		}
	};

	if (vscode.window.activeTextEditor) {
		updateForEditor();
		void offerAchLanguageMode(vscode.window.activeTextEditor.document);
	}

	const scheduleDocumentUpdate = (doc: vscode.TextDocument) => {
		const key = doc.uri.toString();
		const existing = documentUpdateTimers.get(key);
		if (existing) { clearTimeout(existing); }
		const delay = Math.max(0, vscode.workspace.getConfiguration('nachaFileParser', doc.uri).get<number>('validationDebounceMs', 150));
		documentUpdateTimers.set(key, setTimeout(() => {
			documentUpdateTimers.delete(key);
			if (vscode.window.activeTextEditor?.document.uri.toString() === key) {
				updateForEditor();
			}
		}, delay));
	};

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

	let selectionTimer: NodeJS.Timeout | undefined;
	context.subscriptions.push({
		dispose: () => {
			if (selectionTimer) { clearTimeout(selectionTimer); }
			for (const timer of documentUpdateTimers.values()) { clearTimeout(timer); }
			documentUpdateTimers.clear();
		},
	});
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(doc => {
			if (doc.languageId === 'ach') {
				updateForEditor();
			} else {
				void offerAchLanguageMode(doc);
			}
		}),
		vscode.window.onDidChangeActiveTextEditor(editor => {
			updateForEditor();
			if (editor) { void offerAchLanguageMode(editor.document); }
		}),
		vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.languageId === 'ach') {
				scheduleDocumentUpdate(e.document);
			}
		}),
		vscode.window.onDidChangeTextEditorVisibleRanges(e => {
			if (e.textEditor.document.languageId === 'ach') {
				applyFieldDecorations(e.textEditor);
				applyRecordLabels(e.textEditor);
			}
		}),
		vscode.workspace.onDidChangeConfiguration(e => {
			const decorationConfigurationChanged = [
				'nachaFileParser.recordTypeColors',
				'nachaFileParser.batchRowColors',
				'nachaFileParser.fieldColors',
				'nachaFileParser.paddingRowColor',
				'nachaFileParser.accessibleFieldBoundaries',
			].some(setting => e.affectsConfiguration(setting));
			if (
				e.affectsConfiguration('nachaFileParser.validationProfile')
				|| e.affectsConfiguration('nachaFileParser.validationProfiles')
				|| e.affectsConfiguration('nachaFileParser.ruleOverrides')
				|| e.affectsConfiguration('nachaFileParser.maskSensitiveValues')
				|| e.affectsConfiguration('nachaFileParser.showColumnRuler')
				|| e.affectsConfiguration('nachaFileParser.showFieldInlayHints')
				|| e.affectsConfiguration('nachaFileParser.detectAchInTextFiles')
				|| e.affectsConfiguration('nachaFileParser.rowColoring')
				|| e.affectsConfiguration('nachaFileParser.showRecordTypeLabels')
				|| e.affectsConfiguration('nachaFileParser.explorerEntryLimit')
				|| e.affectsConfiguration('nachaFileParser.maxDiagnostics')
				|| decorationConfigurationChanged
			) {
				analysisCache.clear();
				if (decorationConfigurationChanged) {
					createDecorationsForTheme(vscode.window.activeColorTheme.kind);
				}
				inlayHintsProvider.refresh();
				updateForEditor();
				if (e.affectsConfiguration('nachaFileParser.detectAchInTextFiles') && vscode.window.activeTextEditor) {
					detectionOffered.delete(vscode.window.activeTextEditor.document.uri.toString());
					void offerAchLanguageMode(vscode.window.activeTextEditor.document);
				}
			}
		}),
		vscode.window.onDidChangeTextEditorSelection(e => {
			if (e.textEditor.document.languageId !== 'ach') { return; }
			updateCursorContext(e.textEditor);
			if (!explorerView.visible) { return; }
			if (selectionTimer) { clearTimeout(selectionTimer); }
			selectionTimer = setTimeout(() => {
				const position = e.selections[0]?.active;
				if (!position) { return; }
				const node = explorerProvider.nodeAt(position.line, position.character);
				if (node) {
					void explorerView.reveal(node, { select: true, focus: false, expand: 1 });
				}
			}, 50);
		}),
		vscode.workspace.onDidCloseTextDocument(doc => {
			analysisCache.delete(doc.uri.toString());
			const timer = documentUpdateTimers.get(doc.uri.toString());
			if (timer) { clearTimeout(timer); }
			documentUpdateTimers.delete(doc.uri.toString());
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
