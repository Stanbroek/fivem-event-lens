//https://github.com/draivin/hscopes

import * as fs from "fs";
import * as path from "path";

import * as tm from "vscode-textmate";
import * as oniguruma from "vscode-oniguruma";

import { FiveMEventsServer } from "./FiveMEventsServer";
import { DocumentController } from "./hscopes/document";
import * as logger from "./VSCodeLogger";

import * as vscode from "vscode";

const wasmBin = fs.readFileSync(
    path.join(__dirname, "../node_modules/vscode-oniguruma/release/onig.wasm")
).buffer;
const vscodeOnigurumaLib = oniguruma.loadWASM(wasmBin).then(() => {
    return {
        createOnigScanner(patterns: string[]) {
            return new oniguruma.OnigScanner(patterns);
        },
        createOnigString(s: string) {
            return new oniguruma.OnigString(s);
        },
    };
});

interface ExtensionGrammar {
    language?: string;
    scopeName?: string;
    path?: string;
    embeddedLanguages?: { [scopeName: string]: string };
    injectTo?: string[];
}

interface ExtensionPackage {
    contributes?: {
        languages?: {
            id: string;
            extensions?: string[];
            configuration: string;
        }[];
        grammars?: ExtensionGrammar[];
    };
}

export class TextMateScopeParser implements vscode.Disposable {
    private registry: tm.Registry;

    private grammarExtensions: string[] = [];

    private documents: Map<vscode.Uri, DocumentController>;

    private grammars: Map<string, Promise<tm.IGrammar | null>>;

    public dispose() {
        this.documents.forEach((s) => s.dispose());
    }

    constructor(private server: FiveMEventsServer) {
        this.registry = new tm.Registry({
            onigLib: vscodeOnigurumaLib,
            getInjections: (scopeName) => {
                return this.getInjections(scopeName);
            },
            loadGrammar: async (scopeName) => {
                return await this.loadGrammar(scopeName);
            },
        });

        this.grammarExtensions =
            vscode.workspace
                .getConfiguration("fivem-event-lens")
                .get<string[]>("grammar-extensions") || [];

        this.documents = new Map<vscode.Uri, DocumentController>();
        this.grammars = new Map<string, Promise<tm.IGrammar | null>>();
    }

    private getInjections(scopeName: string) {
        const extensions = vscode.extensions.all.filter(
            (e) =>
                e &&
                e.packageJSON &&
                e.packageJSON.contributes &&
                e.packageJSON.contributes.grammars
        );

        const grammars = extensions.flatMap((e) => {
            return (e!.packageJSON as ExtensionPackage).contributes!.grammars!;
        });

        return grammars
            .filter(
                (g) =>
                    g.scopeName &&
                    g.injectTo &&
                    g.injectTo.some((s) => s === scopeName)
            )
            .map((g) => g.scopeName!);
    }

    private async loadGrammar(scopeName: string) {
        const extensions = vscode.extensions.all.filter(
            (e) =>
                e &&
                e.packageJSON &&
                e.packageJSON.contributes &&
                e.packageJSON.contributes.grammars
        );

        const grammars = extensions.flatMap((e) => {
            return (
                e!.packageJSON as ExtensionPackage
            ).contributes!.grammars!.map((g) => {
                return { id: e!.id, extensionPath: e!.extensionPath, ...g };
            });
        });

        const matchingGrammars = grammars.filter(
            (g) => g.scopeName === scopeName
        );

        for (const grammar of matchingGrammars) {
            if (grammar.path === undefined) {
                console.warn("unable to get grammar path for:", grammar.id);
                continue;
            }
            const filePath = path.join(grammar.extensionPath, grammar.path);
            const content = await fs.promises.readFile(filePath, "utf-8");

            try {
                return tm.parseRawGrammar(content, filePath);
            } catch (err) {
                console.error(
                    "unable to load grammar for scope:",
                    scopeName,
                    err
                );
            }
        }

        console.warn("unable to get grammar for scope:", scopeName);
    }

    public getLanguageId(extension: string) {
        const extensions = this.grammarExtensions
            .map((e) => vscode.extensions.getExtension(e))
            .filter(
                (e) =>
                    e &&
                    e.packageJSON &&
                    e.packageJSON.contributes &&
                    e.packageJSON.contributes.languages
            );

        const languages = extensions.flatMap((e) => {
            return (e!.packageJSON as ExtensionPackage).contributes!.languages!;
        });

        const matchingLanguages = languages.filter(
            (l) => l.extensions && l.extensions.includes(extension)
        );

        if (matchingLanguages.length > 0) {
            return matchingLanguages[0].id;
        }
    }

    private getLanguageScopeName(languageId: string) {
        const extensions = this.grammarExtensions
            .map((e) => vscode.extensions.getExtension(e))
            .filter(
                (e) =>
                    e &&
                    e.packageJSON &&
                    e.packageJSON.contributes &&
                    e.packageJSON.contributes.grammars
            );

        const grammars = extensions.flatMap((e) => {
            return (e!.packageJSON as ExtensionPackage).contributes!.grammars!;
        });

        const matchingLanguages = grammars.filter(
            (g) => g.language === languageId
        );

        if (matchingLanguages.length > 0) {
            return matchingLanguages[0].scopeName;
        }
    }

    private async getGrammer(languageId: string) {
        const scopeName = this.getLanguageScopeName(languageId);
        if (scopeName) {
            let grammarPromise: Promise<tm.IGrammar | null> | undefined =
                this.grammars.get(scopeName);
            if (grammarPromise) {
                const grammar = await grammarPromise;
                if (grammar) {
                    return grammar;
                }
            }
            console.log("loading grammar:", languageId);
            grammarPromise = this.registry.loadGrammar(scopeName);
            this.grammars.set(scopeName, grammarPromise);

            return await grammarPromise;
        }
    }

    private async addDocument(document: vscode.TextDocument) {
        let prettyDoc = this.documents.get(document.uri);
        if (prettyDoc) {
            await prettyDoc.refresh();
            console.log("refreshed controller:", document.fileName);
        } else {
            const grammar = await this.getGrammer(document.languageId);
            if (grammar) {
                prettyDoc = new DocumentController(document, grammar);
                await prettyDoc.init();
                this.documents.set(document.uri, prettyDoc);
                console.log("added controller:", document.fileName);
            } else {
                logger.warn("Failed to load grammar for:", document.languageId);
            }
        }
    }

    public async closeDocument(uri: vscode.Uri) {
        const prettyDoc = this.documents.get(uri);
        if (prettyDoc) {
            prettyDoc.dispose();
            this.documents.delete(uri);
            console.log("removed controller:", uri.fsPath);
        }
    }

    public async getScopeAt(
        document: vscode.TextDocument,
        position: vscode.Position
    ) {
        const prettyDoc = this.documents.get(document.uri);
        if (!prettyDoc) {
            await this.addDocument(document);
        }
        return this.documents.get(document.uri)!.getScopeAt(position);
    }
}
