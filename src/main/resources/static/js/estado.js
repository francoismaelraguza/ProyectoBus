// Estado compartido: catálogo en memoria y favoritos.

import * as api from "./api.js";

export const datos = {
    lineas: [],
    paradas: [],
    lineaPorId: new Map(),
    paradaPorId: new Map(),
};

let promesaCatalogo = null;

/** Carga el catálogo una sola vez; si falla, permite reintentar. */
export function cargarCatalogo() {
    if (!promesaCatalogo) {
        promesaCatalogo = api.catalogo()
            .then((c) => {
                datos.lineas = [...c.lineas].sort(compararLineas);
                datos.paradas = c.paradas;
                datos.lineaPorId = new Map(c.lineas.map((l) => [l.id, l]));
                datos.paradaPorId = new Map(c.paradas.map((p) => [p.id, p]));
                return datos;
            })
            .catch((e) => {
                promesaCatalogo = null;
                throw e;
            });
    }
    return promesaCatalogo;
}

/** Orden natural por número comercial: 1, 1A, 2, 3A, 10, 12, BUH… */
export function compararLineas(a, b) {
    const na = parseInt(a.nombre, 10);
    const nb = parseInt(b.nombre, 10);
    const aNum = !Number.isNaN(na);
    const bNum = !Number.isNaN(nb);
    if (aNum && bNum && na !== nb) return na - nb;
    if (aNum !== bNum) return aNum ? -1 : 1;
    return a.nombre.localeCompare(b.nombre, "es", { numeric: true }) || a.id - b.id;
}

/** Líneas (sin repetir número comercial) que paran en una parada. */
export function lineasDeParada(parada, { excluirNombre = null } = {}) {
    const vistas = new Set();
    const resultado = [];
    for (const id of parada.lineas) {
        const l = datos.lineaPorId.get(id);
        if (!l || l.nombre === excluirNombre || vistas.has(l.nombre)) continue;
        vistas.add(l.nombre);
        resultado.push(l);
    }
    return resultado.sort(compararLineas);
}

/**
 * Destino de una línea visto desde una parada: la última parada de la primera
 * ruta del catálogo que contiene la parada y no termina en ella.
 */
export function destinoHacia(lineaId, paradaId) {
    const linea = datos.lineaPorId.get(lineaId);
    if (!linea) return null;
    for (const ruta of linea.rutas) {
        const i = ruta.indexOf(paradaId);
        if (i >= 0 && i < ruta.length - 1) {
            const ultima = datos.paradaPorId.get(ruta[ruta.length - 1]);
            if (ultima) return ultima.nombre;
        }
    }
    return linea.destino || null;
}

// ---------- Favoritos (localStorage, siempre en try/catch) ----------

const CLAVE_FAVS = "favs";

export function favoritas() {
    try {
        const valor = JSON.parse(localStorage.getItem(CLAVE_FAVS) || "[]");
        return Array.isArray(valor) ? valor.filter(Number.isInteger) : [];
    } catch {
        return [];
    }
}

function guardarFavoritas(ids) {
    try {
        localStorage.setItem(CLAVE_FAVS, JSON.stringify(ids));
    } catch {
        /* sin almacenamiento disponible */
    }
}

export const esFavorita = (id) => favoritas().includes(id);

/** Devuelve true si tras la llamada la parada es favorita. */
export function alternarFavorita(id) {
    const ids = favoritas();
    const nuevas = ids.includes(id) ? ids.filter((f) => f !== id) : [...ids, id];
    guardarFavoritas(nuevas);
    return nuevas.includes(id);
}
