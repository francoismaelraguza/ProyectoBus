// Vista «Paradas» (inicio): favoritas con llegadas en vivo y paradas cercanas.

import * as api from "../api.js";
import { compararLineas, datos, favoritas, lineasDeParada } from "../estado.js";
import { distancia, esc, icono, insignia, insignias, minutos } from "../ui.js";
import { obtenerUbicacion, paradasCercanas } from "../geo.js";
import * as mapa from "../mapa.js";

const MAX_FAVORITAS = 6;
const REFRESCO_MS = 30_000;

// Se conserva entre visitas a la vista
let cercanas = null;

export function montar({ contenedor }) {
    document.title = "Paradas · ProyectoBus";
    mapa.limpiarRecorrido();
    mapa.limpiarBuses();
    mapa.resaltarParada(null);

    const ids = favoritas().filter((id) => datos.paradaPorId.has(id)).slice(0, MAX_FAVORITAS);

    contenedor.innerHTML = `
        <h1>Paradas</h1>
        <section aria-labelledby="h-fav">
            <h2 id="h-fav">Favoritas</h2>
            ${ids.length ? `<div class="tarjeta" id="favoritas">${ids.map(filaFavorita).join("")}</div>`
                : `<p class="tarjeta-vacia">Aún no tienes paradas favoritas. Busca una parada o tócala en el mapa y guárdala con la estrella.</p>`}
        </section>
        <section aria-labelledby="h-cerca">
            <h2 id="h-cerca">Cerca de ti</h2>
            <button type="button" class="boton boton-primario" id="btn-cerca">${icono("ubicacion")}<span>Usar mi ubicación</span></button>
            <div id="cerca" aria-live="polite"></div>
        </section>
        <section aria-labelledby="h-lineas">
            <h2 id="h-lineas">Líneas</h2>
            <div class="rejilla-lineas">${lineasUnicas().map((l) =>
                `<a class="enlace-insignia" href="?linea=${Number(l.id)}" aria-label="Línea ${esc(l.nombre)}, ${esc(l.origen)} – ${esc(l.destino)}">${insignia(l)}</a>`).join("")}</div>
        </section>`;

    let cancelado = false;
    const cuerpoCerca = contenedor.querySelector("#cerca");
    if (cercanas) pintarCercanas(cuerpoCerca, cercanas);

    async function buscarCercanas(silencioso = false) {
        if (!silencioso) cuerpoCerca.innerHTML = `<p class="nota">Buscando tu ubicación…</p>`;
        try {
            const pos = await obtenerUbicacion();
            if (cancelado) return;
            mapa.marcarUsuario(pos);
            cercanas = { pos, lista: paradasCercanas(datos.paradas, pos, 5) };
            pintarCercanas(cuerpoCerca, cercanas);
            mapa.ajustarA(L.latLngBounds([pos, ...cercanas.lista.map((c) => [c.parada.lat, c.parada.lng])]));
        } catch (e) {
            if (cancelado) return;
            if (silencioso) { cuerpoCerca.innerHTML = ""; return; }
            cuerpoCerca.innerHTML = e.denegado
                ? `<p class="nota">Activa la ubicación en el navegador o busca la parada por nombre.</p>`
                : `<p class="nota">No se pudo obtener tu ubicación. Busca la parada por nombre.</p>`;
        }
    }
    contenedor.querySelector("#btn-cerca").addEventListener("click", () => buscarCercanas());

    // Si el permiso ya está concedido, «Cerca de ti» se carga solo
    if (!cercanas && navigator.permissions?.query) {
        navigator.permissions.query({ name: "geolocation" })
            .then((r) => { if (r.state === "granted" && !cancelado) buscarCercanas(true); })
            .catch(() => {});
    }

    // Llegadas de las favoritas
    const control = new AbortController();

    async function refrescar() {
        if (!ids.length || document.hidden) return;
        const resultados = await Promise.allSettled(ids.map((id) => api.llegadas(id, { signal: control.signal })));
        if (cancelado) return;
        resultados.forEach((r, i) => {
            const celda = contenedor.querySelector(`[data-llegadas="${ids[i]}"]`);
            if (!celda) return;
            if (r.status === "fulfilled") celda.innerHTML = llegadasResumen(r.value);
            else if (!celda.dataset.listo) celda.innerHTML = `<span class="gris">Sin datos ahora</span>`;
            if (r.status === "fulfilled") celda.dataset.listo = "1";
        });
    }

    refrescar();
    const temporizador = setInterval(refrescar, REFRESCO_MS);
    const alVisible = () => { if (!document.hidden) refrescar(); };
    document.addEventListener("visibilitychange", alVisible);

    return {
        destruir() {
            cancelado = true;
            control.abort();
            clearInterval(temporizador);
            document.removeEventListener("visibilitychange", alVisible);
        },
    };
}

function filaFavorita(id) {
    const p = datos.paradaPorId.get(id);
    return `<a class="fila fila-fav" href="?parada=${id}">
        <span class="fila-texto"><span class="fila-titulo truncar">${esc(p.nombre)}</span><span class="fila-sub">Parada ${id}</span></span>
        <span class="fav-llegadas" data-llegadas="${id}"><span class="esq esq-cifra" aria-hidden="true"></span></span>
    </a>`;
}

/** Hasta 2 próximas llegadas (una por línea): insignia + minutos. */
function llegadasResumen(data) {
    const proximas = data.lineas
        .filter((l) => l.buses.length && l.buses[0].minutos != null)
        .map((l) => ({ linea: l, min: l.buses[0].minutos }))
        .sort((a, b) => a.min - b.min)
        .slice(0, 2);
    if (!proximas.length) return `<span class="gris">Sin buses ahora</span>`;
    return proximas.map((x) =>
        `<span class="fav-llegada">${insignia(x.linea, { pequena: true })}<span class="cifra-peq">${x.min === 0 ? "En parada" : minutos(x.min)}</span></span>`
    ).join("");
}

function pintarCercanas(cuerpo, { lista }) {
    cuerpo.innerHTML = `<div class="tarjeta">${lista.map(({ parada, metros }) =>
        `<a class="fila" href="?parada=${parada.id}">
            <span class="fila-texto"><span class="fila-titulo truncar">${esc(parada.nombre)}</span><span class="fila-insignias">${insignias(lineasDeParada(parada), 4)}</span></span>
            <span class="cifra-peq">${distancia(metros)}</span>
        </a>`).join("")}</div>`;
}

/** Una insignia por número comercial (BUH y UDC tienen dos códigos). */
function lineasUnicas() {
    const vistas = new Set();
    return datos.lineas.filter((l) => !vistas.has(l.nombre) && vistas.add(l.nombre)).sort(compararLineas);
}
