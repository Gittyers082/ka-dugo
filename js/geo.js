export function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("GPS is not available in this browser."));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
                lat: pos.coords.latitude.toFixed(4),
                lng: pos.coords.longitude.toFixed(4)
            }),
            () => reject(new Error("Location permission was not granted.")),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}