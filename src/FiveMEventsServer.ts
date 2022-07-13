import {
    FiveMEventsParser,
    FiveMEvent,
    FiveMEventType,
} from "./FiveMEventsParser";
import { EventCodeLens, EventCodelensProvider } from "./EventCodelensProvider";
import { TextMateScopeParser } from "./TextMateScopeParser";
import * as logger from "./VSCodeLogger";

import * as vscode from "vscode";

export class FiveMEventsServer implements vscode.Disposable {
    private eventListenerCache: Map<string, vscode.Location[]>;
    private eventTriggerCache: Map<string, vscode.Location[]>;

    private fileParser: FiveMEventsParser;
    private scopeParser: TextMateScopeParser;

    private codeLensProvider?: EventCodelensProvider;

    private subscriptions: vscode.Disposable[] = [];

    public dispose() {
        this.subscriptions.forEach((s) => s.dispose());
    }

    constructor() {
        this.eventListenerCache = new Map<string, vscode.Location[]>();
        this.eventTriggerCache = new Map<string, vscode.Location[]>();

        this.fileParser = new FiveMEventsParser(this);
        this.scopeParser = new TextMateScopeParser(this);

        this.subscriptions.push(this.scopeParser);

        this.subscriptions.push(
            vscode.workspace.onDidCreateFiles(async (event) => {
                for (const uri of event.files) {
                    const document = await vscode.workspace.openTextDocument(
                        uri
                    );
                    await this.parseTextDocument(document);
                }
                this.resetCodeLensProvider("onDidCreateFiles");
            })
        );
        this.subscriptions.push(
            vscode.workspace.onDidDeleteFiles(async (event) => {
                for (const uri of event.files) {
                    this.removeDocument(uri);
                }
                this.resetCodeLensProvider("onDidDeleteFiles");
            })
        );
        this.subscriptions.push(
            vscode.workspace.onDidRenameFiles(async (event) => {
                for (const file of event.files) {
                    this.removeDocument(file.oldUri);
                    const document = await vscode.workspace.openTextDocument(
                        file.newUri
                    );
                    await this.parseTextDocument(document);
                }
                this.resetCodeLensProvider("onDidRenameFiles");
            })
        );
        // this.subscriptions.push(
        //     vscode.workspace.onDidOpenTextDocument(async (document) => {
        //         this.parseTextDocument(document);
        //     })
        // );
        this.subscriptions.push(
            vscode.workspace.onDidCloseTextDocument((document) => {
                this.scopeParser.closeDocument(document.uri);
                this.fileParser.closeDocument(document.uri);
            })
        );
    }

    private registerCodeLensProvider() {
        this.codeLensProvider = new EventCodelensProvider(this);

        this.subscriptions.push(
            vscode.languages.registerCodeLensProvider(
                this.fileParser.getDocumentSelectors(),
                this.codeLensProvider
            )
        );
    }

    public async initialize() {
        await this.parseWorkspaceFolders();
        this.registerCodeLensProvider();
    }

    public resetCodeLensProvider(reason?: string) {
        this.codeLensProvider?.reset(reason);
    }

    private clearEventsCache(
        cache: Map<string, vscode.Location[]>,
        document?: vscode.Uri
    ) {
        if (document === undefined) {
            cache.clear();
            return;
        }

        let emptyKeys = [];
        for (const eventListener of cache) {
            const eventName = eventListener[0];
            let eventLocations = eventListener[1];
            eventLocations = eventLocations.filter((eventLocation) => {
                return eventLocation.uri.toString() !== document.toString();
            });
            cache.set(eventName, eventLocations);
            if (eventLocations.length === 0) {
                emptyKeys.push(eventName);
            }
        }

        for (const emptyKey of emptyKeys) {
            cache.delete(emptyKey);
        }
    }

    private clearCachedEvents(document?: vscode.Uri) {
        this.clearEventsCache(this.eventListenerCache, document);
        this.clearEventsCache(this.eventTriggerCache, document);
    }

    private cacheEvents(events: FiveMEvent[]) {
        for (const event of events) {
            if (event.type === FiveMEventType.trigger) {
                let eventLocations = this.eventTriggerCache.get(event.name);
                if (eventLocations === undefined) {
                    eventLocations = [];
                }
                eventLocations.push(event.location);
                this.eventTriggerCache.set(event.name, eventLocations);
            } else if (event.type === FiveMEventType.listener) {
                let eventLocations = this.eventListenerCache.get(event.name);
                if (eventLocations === undefined) {
                    eventLocations = [];
                }
                eventLocations.push(event.location);
                this.eventListenerCache.set(event.name, eventLocations);
            } else {
                console.warn("unknown event type:", event.type);
            }
        }
    }

    public async parseWorkspaceFolders() {
        this.clearCachedEvents();
        const events = await this.fileParser.parseWorkspaceFolders();
        this.cacheEvents(events);

        return events;
    }

    public getLanguageId(extension: string) {
        return this.scopeParser.getLanguageId(extension);
    }

    public async parseTextDocument(
        document: vscode.TextDocument,
        token?: vscode.CancellationToken
    ) {
        const { events, update } = await this.fileParser.parseTextDocument(
            document,
            token
        );
        if (update) {
            this.clearCachedEvents(document.uri);
            this.cacheEvents(events);
        }

        return events;
    }

    public getEventLocations(
        codeLens: EventCodeLens,
        token: vscode.CancellationToken
    ) {
        if (codeLens.type === FiveMEventType.trigger) {
            return this.eventListenerCache.get(codeLens.event) || [];
        }
        if (codeLens.type === FiveMEventType.listener) {
            return this.eventTriggerCache.get(codeLens.event) || [];
        }

        console.warn("unknown event type:", codeLens.type);
        return [];
    }

    public removeDocument(uri: vscode.Uri) {
        this.scopeParser.closeDocument(uri);
        this.fileParser.removeDocument(uri);
        this.clearCachedEvents(uri);
    }

    public async getScopeAt(
        document: vscode.TextDocument,
        position: vscode.Position
    ) {
        if (!this.fileParser.shouldSkipPath(document)) {
            return await this.scopeParser.getScopeAt(document, position);
        }

        return null;
    }
}
