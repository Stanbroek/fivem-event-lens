import path = require("path");

import { FiveMEventsServer } from "./FiveMEventsServer";
import * as logger from "./VSCodeLogger";

import * as minimatch from "minimatch";

import * as vscode from "vscode";

interface ConfigEvent {
    languageId: string;
    eventTriggers: string[];
    eventListeners: string[];
}

interface ConfigEventRegex {
    regex: string;
    functionNameIndex: number;
    eventNameIndex: number;
}

type EventRegex = {
    regex: RegExp;
    functionNameIndex: number;
    eventNameIndex: number;
};

export enum FiveMEventType {
    trigger,
    listener,
}

export type FiveMEvent = {
    type: FiveMEventType;
    name: string;
    location: vscode.Location;
};

export class FiveMEventsParser {
    private statusBarItem?: vscode.StatusBarItem;

    private documentExcludeGlobs: string[];
    private maxFileSize: number;

    private regexPerLanguage: Map<string, EventRegex>;

    private eventTriggersPerLanguage: Map<string, string[]>;
    private eventListenersPerLanguage: Map<string, string[]>;

    private documentCache: Map<
        vscode.Uri,
        { version: number; events: FiveMEvent[] }
    >;

    constructor(private server: FiveMEventsServer) {
        const eventsPerLanguage = vscode.workspace
            .getConfiguration("fivem-event-lens")
            .get<ConfigEvent[]>("events");
        if (eventsPerLanguage === undefined) {
            throw new Error("Could not get the events from configuration.");
        }

        const eventsRegex = vscode.workspace
            .getConfiguration("fivem-event-lens")
            .get<ConfigEventRegex>("events-regex");
        if (eventsRegex === undefined) {
            throw new Error(
                "Could not get the events regex from configuration."
            );
        }

        const documentExcludeGlobs = vscode.workspace
            .getConfiguration("fivem-event-lens")
            .get<string[]>("document-exclude-globs");
        if (documentExcludeGlobs === undefined) {
            throw new Error(
                "Could not get the document exclude globs from configuration."
            );
        }
        this.documentExcludeGlobs = documentExcludeGlobs;

        const maxFileSize = vscode.workspace
            .getConfiguration("fivem-event-lens")
            .get<number>("max-file-size");
        if (maxFileSize === undefined) {
            throw new Error(
                "Could not get the max file size from configuration."
            );
        }
        this.maxFileSize = maxFileSize;

        this.regexPerLanguage = new Map<string, EventRegex>();
        this.eventTriggersPerLanguage = new Map<string, string[]>();
        this.eventListenersPerLanguage = new Map<string, string[]>();
        for (const languageEvents of eventsPerLanguage) {
            const languageId = languageEvents.languageId;
            this.eventTriggersPerLanguage.set(
                languageId,
                languageEvents.eventTriggers
            );
            this.eventListenersPerLanguage.set(
                languageId,
                languageEvents.eventListeners
            );

            const events = languageEvents.eventTriggers.concat(
                languageEvents.eventListeners
            );
            this.regexPerLanguage.set(languageId, {
                regex: new RegExp(
                    eventsRegex.regex.replace("{EVENTS}", events.join("|")),
                    "gm"
                ),
                functionNameIndex: eventsRegex.functionNameIndex,
                eventNameIndex: eventsRegex.eventNameIndex,
            });
        }

        this.documentCache = new Map<
            vscode.Uri,
            { version: number; events: FiveMEvent[] }
        >();
    }

    public getDocumentSelectors() {
        return Array.from(this.regexPerLanguage.keys());
    }

    private setStatusBarItemTooltop(tooltip: string) {
        if (this.statusBarItem !== undefined) {
            this.statusBarItem.tooltip = tooltip;
        }
    }

    public shouldSkipPath(document: { uri: vscode.Uri; languageId?: string }) {
        if (!document.uri) {
            return true;
        }

        for (const glob of this.documentExcludeGlobs) {
            if (minimatch(document.uri.path, glob)) {
                return true;
            }
        }

        if (document.languageId) {
            return !this.regexPerLanguage.has(document.languageId);
        } else {
            const fileExt = path.extname(document.uri.path);
            if (fileExt) {
                const languageId = this.server.getLanguageId(fileExt);
                return !languageId || !this.regexPerLanguage.has(languageId);
            }
        }

        return false;
    }

    private async parseResource(folder: vscode.Uri) {
        if (this.shouldSkipPath({ uri: folder })) {
            return [];
        }

        let events: FiveMEvent[] = [];
        const files = await vscode.workspace.fs.readDirectory(folder);

        (
            await Promise.allSettled(
                files.map(async (file) => {
                    const [fileName, fileType] = file;
                    const filePath = vscode.Uri.joinPath(folder, fileName);
                    if (this.shouldSkipPath({ uri: filePath })) {
                        return;
                    }

                    if (fileType === vscode.FileType.File) {
                        try {
                            const document =
                                await vscode.workspace.openTextDocument(
                                    filePath
                                );
                            if (document) {
                                events.push(
                                    ...(await this.parseTextDocument(document))
                                        .events
                                );
                            }
                        } catch (error) {
                            logger.error(
                                "Failed to parse:",
                                this.getResourcePath(filePath, false),
                                error
                            );
                        }
                    } else if (fileType === vscode.FileType.Directory) {
                        console.log(
                            "parsing folder:",
                            this.getResourcePath(filePath, false)
                        );
                        events.push(...(await this.parseResource(filePath)));
                    }
                })
            )
        )
            .filter((p) => p.status === "rejected")
            .forEach((p) => {
                throw new Error((p as PromiseRejectedResult).reason);
            });

        return events;
    }

    private async parseResources(folder: vscode.Uri) {
        if (this.shouldSkipPath({ uri: folder })) {
            return [];
        }

        let events: FiveMEvent[] = [];
        const files = await vscode.workspace.fs.readDirectory(folder);

        for (const file of files) {
            const [fileName, fileType] = file;
            const filePath = vscode.Uri.joinPath(folder, fileName);
            if (this.shouldSkipPath({ uri: filePath })) {
                continue;
            }

            if (fileType === vscode.FileType.Directory) {
                if (fileName.startsWith("[") && fileName.endsWith("]")) {
                    events.push(...(await this.parseResources(filePath)));
                } else {
                    const innerFiles = await vscode.workspace.fs.readDirectory(
                        filePath
                    );

                    if (
                        innerFiles.flat().includes("fxmanifest.lua") ||
                        innerFiles.flat().includes("__resource.lua")
                    ) {
                        console.log(
                            "parsing resource:",
                            this.getResourcePath(filePath, false)
                        );
                        this.setStatusBarItemTooltop(
                            "Parsing: " + this.getResourcePath(filePath, false)
                        );
                        events.push(...(await this.parseResource(filePath)));
                    }
                }
            }
        }

        return events;
    }

    public async parseWorkspaceFolders() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            "fivem-event-lens.status-bar-item",
            vscode.StatusBarAlignment.Left
        );
        this.statusBarItem.text = "$(loading~spin) parsing resources";
        this.statusBarItem.show();

        let events: FiveMEvent[] = [];
        if (vscode.workspace.workspaceFolders !== undefined) {
            for (const workspaceFolder of vscode.workspace.workspaceFolders) {
                events.push(
                    ...(await this.parseResources(
                        vscode.Uri.joinPath(workspaceFolder.uri, "resources")
                    ))
                );
            }
        }

        this.statusBarItem.dispose();
        this.statusBarItem = undefined;

        return events;
    }

    private getLanguageEventRegex(languageId: string) {
        const regex = this.regexPerLanguage.get(languageId);
        if (regex) {
            return regex;
        }
    }

    private getResourcePath(filePath: vscode.Uri, stripSubFolders = true) {
        let relativePath = vscode.workspace.asRelativePath(filePath, false);
        // Bit hacky but works for now.
        if (stripSubFolders && relativePath.startsWith("resources/")) {
            let pathSegments = relativePath.substring(10).split("/").reverse();
            while (
                pathSegments.length > 0 &&
                pathSegments[pathSegments.length - 1].startsWith("[") &&
                pathSegments[pathSegments.length - 1].endsWith("]")
            ) {
                pathSegments.pop();
            }
            if (pathSegments.length > 0) {
                relativePath = pathSegments.reverse().join("/");
            }
        }

        return relativePath;
    }

    private async timeout<T>(
        prom: Promise<T>,
        time: number
    ): Promise<{ failed: boolean; prom: Promise<T> }> {
        let timer: any;
        let failed = false;
        const timeout = Symbol();
        await Promise.race([
            prom,
            new Promise((_r, rej) => (timer = setTimeout(rej, time, timeout))),
        ])
            .catch((e) => {
                if (e === timeout) {
                    failed = true;
                } else {
                    throw e;
                }
            })
            .finally(() => clearTimeout(timer));

        return { failed, prom };
    }

    public async parseTextDocument(
        document: vscode.TextDocument,
        token?: vscode.CancellationToken
    ): Promise<{ events: FiveMEvent[]; update: boolean }> {
        const { failed, prom } = await this.timeout(
            this.parseTextDocumentInner(document, token),
            3000
        );
        if (failed) {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Parsing file is taking longer then expected:",
                },
                async (progress) => {
                    progress.report({
                        message: this.getResourcePath(document.uri),
                    });

                    await prom;
                }
            );
        }

        return await prom;
    }

    private async parseTextDocumentInner(
        document: vscode.TextDocument,
        token?: vscode.CancellationToken
    ): Promise<{ events: FiveMEvent[]; update: boolean }> {
        let events: FiveMEvent[] = [];
        if (this.shouldSkipPath(document)) {
            return { events: [], update: false };
        }

        const cacheEntry = this.documentCache.get(document.uri);
        if (cacheEntry && cacheEntry.version === document.version) {
            return { events: cacheEntry.events, update: false };
        }

        const eventRegex = this.getLanguageEventRegex(document.languageId);
        if (eventRegex === undefined) {
            logger.warn(
                `No regex found for languageId: ${document.languageId}.\n` +
                    `To support ${document.languageId} documents add them to ` +
                    "fivem-event-lens.events in your config."
            );
            return { events: [], update: false };
        }

        const text = document.getText();
        if (!token && text.length > this.maxFileSize) {
            const stat = await vscode.workspace.fs.stat(document.uri);
            logger.warn(
                `Skipped large file: "${this.getResourcePath(
                    document.uri
                )}" (${Math.round(stat.size / 1024)}KiB)`
            );

            return { events: [], update: false };
        }

        console.log("parsing file:", this.getResourcePath(document.uri));

        const regex = new RegExp(eventRegex.regex);
        let matches;
        while ((matches = regex.exec(text)) !== null) {
            if (token && token.isCancellationRequested) {
                break;
            }

            const line = document.lineAt(
                document.positionAt(matches.index).line
            );
            const indexOf = line.text.indexOf(
                matches[eventRegex.functionNameIndex]
            );
            const position = new vscode.Position(line.lineNumber, indexOf);

            const eventFunc = matches[eventRegex.functionNameIndex];
            const eventName = matches[eventRegex.eventNameIndex].slice(1, -1);

            const scopes = await this.server.getScopeAt(document, position);

            if (
                scopes === null ||
                scopes.text !== eventFunc ||
                !scopes.scopes[scopes.scopes.length - 1].includes("function")
            ) {
                continue;
            }

            const eventLocation = new vscode.Location(document.uri, position);
            if (
                this.eventListenersPerLanguage
                    .get(document.languageId)
                    ?.includes(eventFunc)
            ) {
                events.push({
                    type: FiveMEventType.listener,
                    name: eventName,
                    location: eventLocation,
                });
            } else if (
                this.eventTriggersPerLanguage
                    .get(document.languageId)
                    ?.includes(eventFunc)
            ) {
                events.push({
                    type: FiveMEventType.trigger,
                    name: eventName,
                    location: eventLocation,
                });
            } else {
                logger.warn("Unknown event function:", eventFunc);
            }
        }

        this.documentCache.set(document.uri, {
            version: document.version,
            events,
        });

        return { events, update: true };
    }

    public closeDocument(uri: vscode.Uri) {
        const document = this.documentCache.get(uri);
        if (document) {
            this.documentCache.set(uri, {
                version: -1,
                events: document.events,
            });
        }
    }

    public removeDocument(uri: vscode.Uri) {
        this.documentCache.delete(uri);
    }
}
