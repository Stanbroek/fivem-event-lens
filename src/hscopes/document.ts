import * as tm from "vscode-textmate";
import AwaitLock from "await-lock";

import * as textUtil from "./text-util";

import * as vscode from "vscode";

export class DocumentController implements vscode.Disposable {
    private subscriptions: vscode.Disposable[] = [];

    // Stores the state for each line
    private grammarState: tm.StackElement[] = [];

    private lock: AwaitLock;

    public constructor(
        private document: vscode.TextDocument,
        private grammar: tm.IGrammar
    ) {
        this.lock = new AwaitLock();
    }

    public async init() {
        this.lock.acquireAsync();
        try {
            // Parse whole document
            const docRange = new vscode.Range(0, 0, this.document.lineCount, 0);
            await this.reparsePretties(docRange);
        } finally {
            this.lock.release();
        }

        this.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(async (e) => {
                if (e.document === this.document) {
                    await this.onChangeDocument(e);
                }
            })
        );
    }

    public dispose() {
        this.subscriptions.forEach((s) => s.dispose());
    }

    private refreshTokensOnLine(line: vscode.TextLine): {
        tokens: tm.IToken[];
        invalidated: boolean;
    } {
        if (!this.grammar) {
            return { tokens: [], invalidated: false };
        }
        const prevState = this.grammarState[line.lineNumber - 1] || null;
        const lineTokens = this.grammar.tokenizeLine(line.text, prevState);
        const invalidated =
            !this.grammarState[line.lineNumber] ||
            !lineTokens.ruleStack.equals(this.grammarState[line.lineNumber]);
        this.grammarState[line.lineNumber] = lineTokens.ruleStack;
        return { tokens: lineTokens.tokens, invalidated: invalidated };
    }

    public getScopeAt(position: vscode.Position) {
        if (!this.grammar) {
            return null;
        }

        this.lock.acquireAsync();
        try {
            position = this.document.validatePosition(position);
            const state = this.grammarState[position.line - 1] || null;
            const line = this.document.lineAt(position.line);
            const tokens = this.grammar.tokenizeLine(line.text, state);

            for (let t of tokens.tokens) {
                if (
                    t.startIndex <= position.character &&
                    position.character < t.endIndex
                ) {
                    return {
                        range: new vscode.Range(
                            position.line,
                            t.startIndex,
                            position.line,
                            t.endIndex
                        ),
                        text: line.text.substring(t.startIndex, t.endIndex),
                        scopes: t.scopes,
                    };
                }
            }
            // FIXME: No token matched, return last token in the line.
            console.warn("No token matched, return last token in the line.");
            let lastToken = tokens.tokens[tokens.tokens.length - 1];
            return {
                range: new vscode.Range(
                    position.line,
                    lastToken.startIndex,
                    position.line,
                    lastToken.endIndex
                ),
                text: line.text.substring(
                    lastToken.startIndex,
                    lastToken.endIndex
                ),
                scopes: lastToken.scopes,
            };
        } finally {
            this.lock.release();
        }
    }

    private async reparsePretties(range: vscode.Range) {
        range = this.document.validateRange(range);

        let invalidatedTokenState = false;

        // Collect new pretties
        const lineCount = this.document.lineCount;
        let lineIdx: number;
        for (
            lineIdx = range.start.line;
            lineIdx <= range.end.line ||
            (invalidatedTokenState && lineIdx < lineCount);
            ++lineIdx
        ) {
            // allow for context switch in large files.
            await Promise.resolve();
            const line = this.document.lineAt(lineIdx);
            const { invalidated: invalidated } = this.refreshTokensOnLine(line);
            invalidatedTokenState = invalidated;
        }
    }

    private async applyChanges(
        changes: readonly vscode.TextDocumentContentChangeEvent[]
    ) {
        this.lock.acquireAsync();
        try {
            const sortedChanges = [...changes].sort((change1, change2) =>
                change1.range.start.isAfter(change2.range.start) ? -1 : 1
            );
            for (const change of sortedChanges) {
                const delta = textUtil.toRangeDelta(
                    change.range,
                    change.text
                );
                const editRange = textUtil.rangeDeltaNewRange(delta);

                await this.reparsePretties(editRange);
            }
        } finally {
            this.lock.release();
        }
    }

    private async onChangeDocument(event: vscode.TextDocumentChangeEvent) {
        await this.applyChanges(event.contentChanges);
    }

    public async refresh() {
        this.lock.acquireAsync();
        try {
            this.grammarState = [];
            const docRange = new vscode.Range(0, 0, this.document.lineCount, 0);
            await this.reparsePretties(docRange);
        } finally {
            this.lock.release();
        }
    }
}
