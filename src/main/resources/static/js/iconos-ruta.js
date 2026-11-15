// Iconos del planificador de rutas (SVG de trazo, currentColor). Aparte de ui.js para no mezclar ramas.

const TRAZOS = {
    andar: '<circle cx="13.5" cy="4.5" r="1.6"/><path d="M12.5 8.5 11 14M12.5 8.5l-3 2.5M12.5 8.5l3 3 2-.5M11 14l3 3.5.5 3.5M11 14l-2 3.5-2 2.5"/>',
    intercambiar: '<path d="M8 20V5M8 5 4.5 8.5M8 5l3.5 3.5M16 4v15M16 19l-3.5-3.5M16 19l3.5-3.5"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
};

export function iconoRuta(nombre, { tam = 18 } = {}) {
    return `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TRAZOS[nombre]}</svg>`;
}
