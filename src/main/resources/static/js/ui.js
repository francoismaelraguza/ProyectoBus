// Utilidades de interfaz: escape de HTML, iconos, formatos e insignia de línea.

const ENTIDADES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapa todo texto que venga de la API antes de meterlo en innerHTML. */
export function esc(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, (c) => ENTIDADES[c]);
}

export const NBSP = " ";

// ---------- Formatos ----------

const nf0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });
const fHora = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

export const entero = (n) => nf0.format(n);
export const decimal = (n) => nf1.format(n);
export const hora = (fecha = new Date()) => fHora.format(fecha);

/** 120 m · 2,5 km */
export function distancia(metros) {
    if (metros < 950) return `${nf0.format(Math.max(10, Math.round(metros / 10) * 10))}${NBSP}m`;
    return `${nf1.format(metros / 1000)}${NBSP}km`;
}

export const minutos = (n) => `${nf0.format(n)}${NBSP}min`;

export function normalizar(texto) {
    return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ---------- Color de línea y contraste ----------

function colorSeguro(hex) {
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#888888";
}

function luminancia(hex) {
    const canal = (i) => {
        const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

const LUM_TINTA = luminancia("#0a0a0a");

/** Blanco o casi negro, el que más contraste WCAG dé sobre el color de la línea. */
export function tintaSobre(hex) {
    const l = luminancia(colorSeguro(hex));
    const contraBlanco = 1.05 / (l + 0.05);
    const contraTinta = (l + 0.05) / (LUM_TINTA + 0.05);
    return contraBlanco >= contraTinta ? "#ffffff" : "#0a0a0a";
}

/** El único elemento con color de la interfaz. */
export function insignia(linea, { pequena = false } = {}) {
    const color = colorSeguro(linea.color);
    return `<span class="insignia${pequena ? " insignia-pq" : ""}" style="--linea:${color};--tinta-linea:${tintaSobre(color)}">${esc(linea.nombre)}</span>`;
}

/** Varias insignias pequeñas (máx. N) y «+N» si sobran. */
export function insignias(lineas, max = 4) {
    const visibles = lineas.slice(0, max).map((l) => insignia(l, { pequena: true })).join("");
    const resto = lineas.length - max;
    return visibles + (resto > 0 ? `<span class="mas-lineas">+${resto}</span>` : "");
}

export { colorSeguro };

// ---------- Iconos (SVG de trazo, currentColor) ----------

const TRAZOS = {
    lupa: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    estrella: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8Z"/>',
    atras: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    cerrar: '<path d="M6 6l12 12M18 6 6 18"/>',
    ubicacion: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="7.5"/>',
    actualizar: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
};

export function icono(nombre, { tam = 18, relleno = false } = {}) {
    return `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="${relleno ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TRAZOS[nombre]}</svg>`;
}

// ---------- Fragmentos comunes ----------

/** Barras grises planas para estados de carga. */
export function esqueletoFilas(n = 3) {
    return Array.from({ length: n }, () =>
        `<div class="fila fila-esqueleto" aria-hidden="true"><span class="esq esq-insignia"></span><span class="esq-bloque"><span class="esq esq-linea"></span><span class="esq esq-linea esq-corta"></span></span><span class="esq esq-cifra"></span></div>`
    ).join("");
}
