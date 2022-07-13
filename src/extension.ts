import { JenkinsHashHoverProvider } from "./JenkinsHashHoverProvider";
import { FiveMEventsServer } from "./FiveMEventsServer";

import * as vscode from "vscode";

let eventServer: FiveMEventsServer;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed.
export async function activate(context: vscode.ExtensionContext) {
    console.log("fivem-event-lens activated");

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Starting FiveM events server",
        },
        async (progress) => {
            eventServer = new FiveMEventsServer();
            await eventServer.initialize();
        }
    );

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json.
    context.subscriptions.push(
        vscode.commands.registerCommand("fivem-event-lens.reload-file", () => {
            const activeTextEditor = vscode.window.activeTextEditor;
            if (activeTextEditor !== undefined) {
                vscode.window.setStatusBarMessage(
                    "$(loading~spin) parsing resource",
                    (async function () {
                        eventServer.removeDocument(
                            activeTextEditor.document.uri
                        );
                        eventServer.parseTextDocument(
                            activeTextEditor.document
                        );
                        eventServer.resetCodeLensProvider(
                            "onCommand:reload-file"
                        );
                    })()
                );
            }
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "fivem-event-lens.reload-workspace",
            () => {
                eventServer.parseWorkspaceFolders();
                eventServer.resetCodeLensProvider("onCommand:reload-workspace");
            }
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("fivem-event-lens.test", () => {
            console.log("blieb");
        })
    );

    // Register workspace file events.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(
            async (event: vscode.ConfigurationChangeEvent) => {
                if (event.affectsConfiguration("fivem-event-lens")) {
                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: "Restarting FiveM events server",
                        },
                        async () => {
                            eventServer.dispose();
                            eventServer = new FiveMEventsServer();
                            await eventServer.initialize();
                        }
                    );
                }
            }
        )
    );

    // Register hover provider.
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            ["lua"],
            new JenkinsHashHoverProvider()
        )
    );
}

// this method is called when your extension is deactivated.
export function deactivate() {
    eventServer.dispose();
}
