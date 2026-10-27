export function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }
}

export function showNotification(title, body, iconUrl) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification(title, {
            body: body,
            icon: iconUrl,
            badge: iconUrl,
            tag: "kadugo-" + title,
        });
    });
}