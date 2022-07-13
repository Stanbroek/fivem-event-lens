RegisterCommand("triggerEvents", () => {
    emit("JsEventName", eventParam1, eventParam2);
    emit("JsEventName", eventParam1, eventParam2);

    emitNet("JsClientEventName", eventParam1, eventParam2);

    emitNet("JsServerEventName", eventParam1, eventParam2);
}, false);
