AddEventHandler("LuaEventName", function(eventParam1, eventParam2)
    local hash1 = `annihilator`
    local hash2 = `armytrailer`
    local hash3 = `armytrailer2`
end)

RegisterCommand("triggerEvents", function(source, args, rawCommand)
    local eventParam1 = nil
    local eventParam2 = nil

    -- TriggerEvent('LuaEventName', eventParam1, eventParam2)

    TriggerClientEvent("LuaEventName", eventParam1, eventParam2)

    TriggerServerEvent("OtherLuaEventName", eventParam1, eventParam2)
end, false)
