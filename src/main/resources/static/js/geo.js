// Geometría y geolocalización.

const RADIO_TIERRA = 6_371_000;
const rad = (g) => (g * Math.PI) / 180;

/** Distancia en metros entre dos puntos [lat, lng]. */
export function haversine(a, b) {
    const dLat = rad(b[0] - a[0]);
    const dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * RADIO_TIERRA * Math.asin(Math.sqrt(h));
}

/** Longitud en metros de una polilínea [[lat, lng], ...]. */
export function longitudPolilinea(puntos) {
    let total = 0;
    for (let i = 1; i < puntos.length; i++) total += haversine(puntos[i - 1], puntos[i]);
    return total;
}

/** Las n paradas más cercanas a pos ([lat, lng]), con su distancia en metros. */
export function paradasCercanas(paradas, pos, n = 5) {
    return paradas
        .map((p) => ({ parada: p, metros: haversine(pos, [p.lat, p.lng]) }))
        .sort((x, y) => x.metros - y.metros)
        .slice(0, n);
}

/** Promesa con [lat, lng]; rechaza con { denegado: boolean, mensaje }. */
export function obtenerUbicacion() {
    return new Promise((resolver, rechazar) => {
        if (!("geolocation" in navigator)) {
            rechazar({ denegado: false, mensaje: "Tu navegador no ofrece geolocalización." });
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolver([pos.coords.latitude, pos.coords.longitude]),
            (err) => rechazar({ denegado: err.code === 1, mensaje: err.message }),
            { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
        );
    });
}
