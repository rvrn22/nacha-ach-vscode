import * as assert from 'assert';
import * as vscode from 'vscode';
import { AchHoverProvider } from '../achHover';
import { AchDocumentSymbolProvider, AchFoldingRangeProvider, AchInlayHintsProvider } from '../achNavigation';
import { standardAchRecords } from './fixtures/achFixtures';

async function waitForDiagnostics(uri: vscode.Uri, code: string): Promise<vscode.Diagnostic[]> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (diagnostics.some(diagnostic => {
      const diagnosticCode = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
      return diagnosticCode === code;
    })) {
      return diagnostics;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return vscode.languages.getDiagnostics(uri);
}

suite('Extension Integration Test Suite', () => {
  test('Publishes diagnostics and serves hovers, symbols, and folding through VS Code', async function () {
    this.timeout(10_000);
    const extension = vscode.extensions.all.find(candidate =>
      candidate.packageJSON.name === 'nacha-file-parser'
      && candidate.packageJSON.publisher === 'RaviRanjan');
    assert.ok(extension, 'The NACHA extension should be installed in the test host');
    await extension.activate();

    const records = standardAchRecords();
    records[2] = records[2].substring(0, 11) + '5' + records[2].substring(12);
    const document = await vscode.workspace.openTextDocument({ language: 'ach', content: records.join('\n') });
    await vscode.window.showTextDocument(document);

    try {
      const diagnostics = await waitForDiagnostics(document.uri, 'ACH-FIELD-ROUTING-CHECK-DIGIT');
      assert.ok(diagnostics.some(diagnostic => {
        const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
        return code === 'ACH-FIELD-ROUTING-CHECK-DIGIT';
      }));

      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        document.uri,
        new vscode.Position(2, 11),
      );
      assert.ok(hovers.length > 0);
      assert.deepStrictEqual(hovers[0].range, new vscode.Range(2, 11, 2, 12));

      const symbols = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>(
        'vscode.executeDocumentSymbolProvider',
        document.uri,
      );
      assert.ok(symbols.some(symbol => symbol.name === 'ACH File'));

      const folding = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
        'vscode.executeFoldingRangeProvider',
        document.uri,
      );
      assert.ok(folding.some(range => range.start === 1 && range.end === 3));
      assert.ok(folding.some(range => range.start === 5 && range.end === 9));
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
  });

  test('Short-circuits every cancellable read provider before document analysis', () => {
    const cancellation = new vscode.CancellationTokenSource();
    cancellation.cancel();
    let resolutions = 0;
    const resolve = () => {
      resolutions++;
      throw new Error('A pre-cancelled provider must not resolve the ACH document');
    };
    const document = {} as vscode.TextDocument;

    assert.deepStrictEqual(new AchDocumentSymbolProvider(resolve).provideDocumentSymbols(document, cancellation.token), []);
    assert.deepStrictEqual(new AchFoldingRangeProvider(resolve).provideFoldingRanges(document, {}, cancellation.token), []);
    assert.deepStrictEqual(new AchInlayHintsProvider(resolve, () => true).provideInlayHints(
      document,
      new vscode.Range(0, 0, 0, 94),
      cancellation.token,
    ), []);
    assert.strictEqual(new AchHoverProvider(resolve).provideHover(
      document,
      new vscode.Position(0, 0),
      cancellation.token,
    ), undefined);
    assert.strictEqual(resolutions, 0);
    cancellation.dispose();
  });
});
