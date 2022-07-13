import * as vscode from "vscode";

export class JenkinsHashHoverProvider implements vscode.HoverProvider {
    private regex: RegExp;

    constructor() {
        this.regex = /`.+`/g;
    }

    // https://github.com/dexyfex/CodeWalker/blob/master/CodeWalker.Core/GameFiles/Utils/Jenk.cs
    private getHashKey(text: string) {
        if (!text) {
            return 0;
        }

        let h = 0;
        for (const char of text) {
            h += char.charCodeAt(0);
            h += h << 10;
            h ^= h >>> 6;
        }
        h += h << 3;
        h ^= h >>> 11;
        h += h << 15;

        return h | 0;
    }

    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ) {
        const range = document.getWordRangeAtPosition(
            position,
            new RegExp(this.regex)
        );
        if (range) {
            const hoveredText = document.getText(range);
            const hash = BigInt.asUintN(
                32,
                BigInt(this.getHashKey(hoveredText.slice(1, -1)))
            );
            return new vscode.Hover(
                `HashKey: 0x${hash
                    .toString(16)
                    .toUpperCase()}, ${hash}, ${BigInt.asIntN(32, hash)}`,
                range
            );
        }

        return null;
    }
}
