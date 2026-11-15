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

// ---------- Medidas sobre un trazado [[lat, lng], ...] ----------

const grados = (r) => (r * 180) / Math.PI;
const acotar = (x, a, b) => Math.min(b, Math.max(a, x));

/** Metros acumulados desde el inicio en cada vértice del trazado. */
export function medidasAcumuladas(trazado) {
    const medidas = new Array(trazado.length).fill(0);
    for (let i = 1; i < trazado.length; i++) {
        medidas[i] = medidas[i - 1] + haversine(trazado[i - 1], trazado[i]);
    }
    return medidas;
}

/** Índice i del último tramo [i, i+1] que empieza en o antes de la medida s. */
function indiceTramo(medidas, s) {
    let lo = 0;
    let hi = medidas.length - 2;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (medidas[mid] <= s) lo = mid; else hi = mid - 1;
    }
    return Math.max(0, lo);
}

/** Punto del trazado a la medida s (metros) y rumbo en grados (0 = norte). rumbo es null si el tramo es nulo. */
export function puntoEn(trazado, medidas, s) {
    if (trazado.length === 1) return { punto: trazado[0], rumbo: null };
    const total = medidas[medidas.length - 1];
    const m = acotar(s, 0, total);
    const i = indiceTramo(medidas, m);
    const largo = medidas[i + 1] - medidas[i];
    const f = largo > 0 ? (m - medidas[i]) / largo : 0;
    const a = trazado[i];
    const b = trazado[i + 1];
    const punto = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    let rumbo = null;
    if (largo >= 1) {
        const dx = (b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2));
        rumbo = (grados(Math.atan2(dx, b[0] - a[0])) + 360) % 360;
    }
    return { punto, rumbo };
}

/**
 * Medida s del punto del trazado más cercano a `punto`, buscando solo entre sMin y sMax.
 * Devuelve { s, dist } (dist en metros hasta el trazado) o null si la ventana está vacía.
 * En empate gana el tramo anterior (los recorridos pasan dos veces por la misma calle).
 */
export function proyectar(trazado, medidas, punto, sMin = 0, sMax = Infinity) {
    const total = medidas[medidas.length - 1];
    const desde = Math.max(0, sMin);
    const hasta = Math.min(total, sMax);
    if (desde > hasta || trazado.length < 2) return null;

    const kx = 111_320 * Math.cos(rad(punto[0]));
    const ky = 110_540;
    let mejor = null;
    for (let i = indiceTramo(medidas, desde); i < trazado.length - 1 && medidas[i] <= hasta; i++) {
        const ax = (trazado[i][1] - punto[1]) * kx;
        const ay = (trazado[i][0] - punto[0]) * ky;
        const dx = (trazado[i + 1][1] - punto[1]) * kx - ax;
        const dy = (trazado[i + 1][0] - punto[0]) * ky - ay;
        const l2 = dx * dx + dy * dy;
        const u = l2 > 0 ? acotar(-(ax * dx + ay * dy) / l2, 0, 1) : 0;
        const dist = Math.hypot(ax + u * dx, ay + u * dy);
        const s = acotar(medidas[i] + u * (medidas[i + 1] - medidas[i]), desde, hasta);
        if (!mejor || dist < mejor.dist - 5) mejor = { s, dist };
    }
    return mejor;
}
