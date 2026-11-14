// Vista de una línea: sentido, datos y «termómetro» de paradas.

import * as api from "../api.js";
import { datos, lineasDeParada } from "../estado.js";
import { colorSeguro, decimal, entero, esc, esqueletoFilas, icono, insignia, insignias, NBSP } from "../ui.js";
import { longitudPolilinea } from "../geo.js";
import * as mapa from "../mapa.js";

const cache = new Map(); // id de línea -> recorrido

export function montar({ contenedor, params }) {
    const id = Number(params.get("linea"));
    const linea = datos.lineaPorId.get(id);
    mapa.limpiarBuses();
    mapa.resaltarParada(null);
    mapa.limpiarRecorrido();

    if (!linea) {
        document.title = "Línea no encontrada · ProyectoBus";
        contenedor.innerHTML = `${enlaceVolver()}<h1>Línea no encontrada</h1><p class="nota">No existe ninguna línea con ese código. <a class="enlace-texto" href="?vista=lineas">Elígela en la lista de líneas.</a></p>`;
        return { destruir() {} };
    }

    document.title = `Línea ${linea.nombre} · ProyectoBus`;
    const cabecera = `
        ${enlaceVolver()}
        <h1 class="h1-linea">Línea ${insignia(linea)}</h1>
        <p class="subtitulo">${esc(linea.origen)} – ${esc(linea.destino)}</p>`;
    contenedor.innerHTML = `${cabecera}<div id="detalle" class="detalle" aria-live="polite"><div class="tarjeta">${esqueletoFilas(4)}</div></div>`;
    const detalle = contenedor.querySelector("#detalle");

    let cancelado = false;
    let control = null;

    async function cargar() {
        detalle.innerHTML = `<div class="tarjeta">${esqueletoFilas(4)}</div>`;
        control?.abort();
        control = new AbortController();
        try {
            let rec = cache.get(id);
            if (!rec) {
                rec = await api.recorrido(id, { signal: control.signal });
                cache.set(id, rec);
            }
            if (!cancelado) pintar(rec);
        } catch (e) {
            if (e.name === "AbortError" || cancelado) return;
            detalle.innerHTML = `<div class="tarjeta"><div class="fila fila-error"><p>No se pudo consultar el recorrido de la línea.</p><button type="button" class="boton-texto" data-reintentar>Reintentar</button></div></div>`;
        }
    }

    function pintar(rec) {
        if (!rec.sentidos?.length) {
            detalle.innerHTML = `<p class="tarjeta-vacia">Esta línea no tiene recorrido publicado ahora mismo.</p>`;
            mapa.limpiarRecorrido();
            return;
        }
        const pedido = params.get("sentido");
        const sentido = rec.sentidos.find((s) => String(s.sentido) === pedido) ?? rec.sentidos[0];
        const km = longitudPolilinea(sentido.trazado) / 1000;
        const ultimo = sentido.paradas.length - 1;

        const segmentos = rec.sentidos.map((s) =>
            `<a class="segmento" href="?linea=${id}&amp;sentido=${Number(s.sentido)}" title="${esc(s.destino)}"${s === sentido ? ' aria-current="true"' : ""}>${esc(s.destino)}</a>`
        ).join("");
        const color = colorSeguro(rec.color);

        const filas = sentido.paradas.map((p, i) => {
            const info = datos.paradaPorId.get(p.id);
            const otras = info ? lineasDeParada(info, { excluirNombre: linea.nombre }) : [];
            const clase = i === 0 ? " primera" : i === ultimo ? " ultima" : "";
            return `<li class="termo-parada${clase}"><a href="?parada=${Number(p.id)}" data-parada="${Number(p.id)}"><span class="fila-titulo truncar">${esc(p.nombre)}</span><span class="fila-insignias">${insignias(otras, 4)}</span></a></li>`;
        }).join("");

        detalle.innerHTML = `
            <div class="sentido"><span class="sentido-etiqueta">Hacia</span><div class="segmentos" role="group" aria-label="Sentido">${segmentos}</div></div>
            <p class="datos-linea">${entero(sentido.paradas.length)}${NBSP}paradas · ${decimal(km)}${NBSP}km</p>
            <ol class="termometro tarjeta" style="--linea:${color}">${filas}</ol>`;

        document.title = `Línea ${linea.nombre} hacia ${sentido.destino} · ProyectoBus`;
        mapa.mostrarRecorrido({ color, trazado: sentido.trazado, paradas: sentido.paradas });
    }

    detalle.addEventListener("click", (e) => {
        if (e.target.closest("[data-reintentar]")) cargar();
    });
    // Al pasar por una parada de la lista, se resalta en el mapa
    const resaltar = (e) => mapa.resaltarParada(Number(e.target.closest("[data-parada]")?.dataset.parada) || null);
    detalle.addEventListener("pointerover", resaltar);
    detalle.addEventListener("focusin", resaltar);
    detalle.addEventListener("pointerleave", () => mapa.resaltarParada(null));
    detalle.addEventListener("focusout", () => mapa.resaltarParada(null));

    cargar();

    return {
        destruir() {
            cancelado = true;
            control?.abort();
            mapa.limpiarRecorrido();
            mapa.resaltarParada(null);
        },
    };
}

function enlaceVolver() {
    return `<a class="volver" href="?vista=lineas">${icono("atras")}<span>Líneas</span></a>`;
}
