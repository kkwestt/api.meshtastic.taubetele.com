
function lowerCaseFirstLetter(string) {
    return string.charAt(0).toLowerCase() + string.slice(1);
}

// базовая фильтрация типов и нейминг
// в идеале, не нужно подписавыться на mqtt.json и подписавывать только на необходимые callback из meshtastic.js

export function getEventType(eventName, eventType) {
    if (eventType === 'json' || eventName === 'onStoreForwardPacket') {
        return;
    }

    let type = lowerCaseFirstLetter(eventType);

    if (eventName === 'onRangeTestPacket') {
        type = 'rangeTest';
    }

    if (eventName === 'onMessagePacket') {
        type = 'message';
    }

    return type;
}
