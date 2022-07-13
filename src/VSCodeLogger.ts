import * as util from "util";

import * as vscode from "vscode";

export function info(message?: any, ...optionalParams: any[]) {
    const msg = util.format(message, ...optionalParams);
    console.info(msg);
    vscode.window.showInformationMessage(msg);
}

export function warn(message?: any, ...optionalParams: any[]) {
    const msg = util.format(message, ...optionalParams);
    console.warn("Warning:", msg);
    vscode.window.showWarningMessage(msg);
}

export function error(message?: any, ...optionalParams: any[]) {
    const msg = util.format(message, ...optionalParams);
    console.error("Error:", msg);
    vscode.window.showErrorMessage(msg);
}
