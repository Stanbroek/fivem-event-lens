// https://github.com/microsoft/vscode-extension-samples/tree/main/codelens-sample
// https://github.com/gitkraken/vscode-gitlens/blob/main/src/codelens/codeLensProvider.ts
// https://github.com/OmniSharp/omnisharp-vscode/blob/master/src/features/codeLensProvider.ts

import * as path from "path";

import { FiveMEventsServer } from "./FiveMEventsServer";
import { FiveMEventType } from "./FiveMEventsParser";
import * as logger from "./VSCodeLogger";

import * as vscode from "vscode";

export class EventCodeLens extends vscode.CodeLens {
    constructor(
        public type: FiveMEventType,
        public event: string,
        public location: vscode.Location,
        command?: vscode.Command
    ) {
        super(location.range, command);
    }
}

export class EventCodelensProvider
    implements vscode.CodeLensProvider<EventCodeLens>
{
    constructor(private server: FiveMEventsServer) {}

    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    get onDidChangeCodeLenses(): vscode.Event<void> {
        return this._onDidChangeCodeLenses.event;
    }

    public reset(reason?: string) {
        logger.info("Reset code lenses:", reason);
        this._onDidChangeCodeLenses.fire();
    }

    public async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ) {
        console.log(
            "Looking code lenses in", path.basename(document.fileName)
        );

        const eventLocations = await this.server.parseTextDocument(
            document,
            token
        );

        let codeLenses = [];
        for (const event of eventLocations) {
            codeLenses.push(
                new EventCodeLens(event.type, event.name, event.location)
            );
        }

        console.log(
            `Found ${codeLenses.length} code lenses in ${path.basename(
                document.fileName
            )}`
        );

        return codeLenses;
    }

    private resolveEventListenerCodeLens(
        codeLens: EventCodeLens,
        eventLocations: vscode.Location[]
    ) {
        const count = eventLocations.length;
        if (count === 0) {
            codeLens.command = {
                title: "No Event Listeners Found",
                command: "",
            };
        } else {
            codeLens.command = {
                title:
                    count === 1
                        ? "1 Event Listener"
                        : `${count} Event Listeners`,
                command: "editor.action.peekLocations",
                arguments: [
                    codeLens.location.uri,
                    codeLens.location.range.start,
                    eventLocations,
                ],
            };
        }

        return codeLens;
    }

    private resolveEventTriggerCodeLens(
        codeLens: EventCodeLens,
        eventLocations: vscode.Location[]
    ) {
        const count = eventLocations.length;
        if (count === 0) {
            codeLens.command = {
                title: "No Event Triggers Found",
                command: "",
            };
        } else {
            codeLens.command = {
                title:
                    count === 1 ? "1 Event Trigger" : `${count} Event Triggers`,
                command: "editor.action.peekLocations",
                arguments: [
                    codeLens.location.uri,
                    codeLens.location.range.start,
                    eventLocations,
                ],
            };
        }

        return codeLens;
    }

    public async resolveCodeLens(
        codeLens: EventCodeLens,
        token: vscode.CancellationToken
    ) {
        const eventLocations = this.server.getEventLocations(codeLens, token);

        if (codeLens.type === FiveMEventType.trigger) {
            codeLens = this.resolveEventListenerCodeLens(
                codeLens,
                eventLocations
            );
        } else if (codeLens.type === FiveMEventType.listener) {
            codeLens = this.resolveEventTriggerCodeLens(
                codeLens,
                eventLocations
            );
        } else {
            console.warn("unknown event type:", codeLens.type);
            return;
        }

        console.log("resolved code lens:", codeLens);

        return codeLens;
    }
}
