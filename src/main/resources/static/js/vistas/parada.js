// Vista de una parada: llegadas en vivo, favorita y líneas que paran.

import * as api from "../api.js";
import { alternarFavorita, datos, destinoHacia, esFavorita, lineasDeParada } from "../estado.js";
import { distancia, entero, esc, esqueletoFilas, icono, insignia, NBSP } from "../ui.js";
import * as mapa from "../mapa.js";

const REFRESCO_MS = 20_000;

export function montar({ contenedor, params }) {
    const id = Number(params.get("parada"));
    const parada = datos.paradaPorId.get(id);
    mapa.limpiarRecorrido();
    mapa.limpiarBuses();

    if (!parada) {
        document.title = "Parada no encontrada · ProyectoBus";
        mapa.resaltarParada(null);
        contenedor.innerHTML = `${enlaceVolver()}<h1>Parada no encontrada</h1><p class="nota">No hay ninguna parada en servicio con el número ${esc(params.get("parada"))}. Búscala por nombre en el buscador.</p>`;
        return { destruir() {} };
    }

    document.title = `${parada.nombre} · ProyectoBus`;
    mapa.resaltarParada(id);
    mapa.volarA([parada.lat, parada.lng]);

    const lineas = lineasDeParada(parada);
    contenedor.innerHTML = `
        ${enlaceVolver()}
        <h1>${esc(parada.nombre)}</h1>
        <div class="meta">
            <p class="meta-texto">Parada ${id} · <span id="actualizado">Actualizando…</span></p>
            <button type="button" class="boton-icono" id="btn-actualizar" aria-label="Actualizar">${icono("actualizar")}</button>
            <button type="button" class="boton-icono" id="btn-fav">${""}</button>
        </div>
        <div class="tarjeta" id="llegadas" aria-live="polite">${esqueletoFilas(3)}</div>
        ${lineas.length ? `<section class="seccion"><h2>Líneas en esta parada</h2>
        <div class="lineas-parada">${lineas.map((l) => `<a class="enlace-insignia" href="?linea=${Number(l.id)}" aria-label="Línea ${esc(l.nombre)}">${insignia(l)}</a>`).join("")}</div></section>` : ""}`;

    const cuerpo = contenedor.querySelector("#llegadas");
    const etiqueta = contenedor.querySelector("#actualizado");
    const btnFav = contenedor.querySelector("#btn-fav");
    const btnAct = contenedor.querySelector("#btn-actualizar");

    function pintarFav() {
        const fav = esFavorita(id);
        btnFav.setAttribute("aria-pressed", String(fav));
        btnFav.setAttribute("aria-label", fav ? "Quitar de favoritas" : "Guardar en favoritas");
        btnFav.innerHTML = icono("estrella", { relleno: fav });
    }
    pintarFav();
    btnFav.addEventListener("click", () => { alternarFavorita(id); pintarFav(); });

    let ultimo = null;       // última respuesta buena
    let cancelado = false;
    let control = null;

    function pintar(error) {
        if (error) {
            const cuando = ultimo ? ` Último dato: ${esc(ultimo.consultado)}.` : "";
            const aviso = `<div class="fila fila-error"><p>No se pudo consultar iTranvías.${cuando}</p><button type="button" class="boton-texto" data-reintentar>Reintentar</button></div>`;
            cuerpo.innerHTML = (ultimo ? filas(ultimo) : "") + aviso;
            return;
        }
        etiqueta.textContent = `Actualizado ${ultimo.consultado}`;
        cuerpo.innerHTML = filas(ultimo);
        mapa.mostrarBuses(ultimo.lineas.flatMap((l) =>
            l.buses.filter((b) => b.lat != null).map((b) => ({ lat: b.lat, lng: b.lng, nombre: l.nombre, color: l.color }))));
    }

    function filas(data) {
        const activas = data.lineas.filter((l) => l.buses.length);
        if (!activas.length) return `<p class="vacio">Ahora mismo no hay buses de camino a esta parada.</p>`;
        return activas.map((l, i) => filaLlegada(l, i, id)).join("");
    }

    async function refrescar() {
        control?.abort();
        control = new AbortController();
        try {
            ultimo = await api.llegadas(id, { signal: control.signal });
            if (!cancelado) pintar(false);
        } catch (e) {
            if (e.name !== "AbortError" && !cancelado) pintar(true);
        }
    }

    cuerpo.addEventListener("click", (e) => {
        if (e.target.closest("[data-reintentar]")) {
            refrescar();
            return;
        }
    });
    btnAct.addEventListener("click", refrescar);

    refrescar();
    const temporizador = setInterval(() => { if (!document.hidden) refrescar(); }, REFRESCO_MS);
    const alVisible = () => { if (!document.hidden) refrescar(); };
    document.addEventListener("visibilitychange", alVisible);

    return {
        destruir() {
            cancelado = true;
            control?.abort();
            clearInterval(temporizador);
            document.removeEventListener("visibilitychange", alVisible);
            mapa.resaltarParada(null);
            mapa.limpiarBuses();
        },
    };
}

function enlaceVolver() {
    return `<a class="volver" href="/">${icono("atras")}<span>Paradas</span></a>`;
}

function filaLlegada(l, i, paradaId) {
    const proximo = l.buses[0];
    const destino = destinoHacia(l.id, paradaId);
    const despues = l.buses.slice(1).filter((b) => b.minutos != null).slice(0, 2).map((b) => entero(b.minutos));
    const min = proximo.minutos;          // null = desconocido
    const dist = proximo.distancia;       // null = el bus aún no ha salido
    const enParada = dist === 0 || (min === 0 && dist != null);
    let cifra;
    if (enParada) cifra = `<span class="cifra-parada">En parada</span>`;
    else if (min == null) cifra = `<span class="cifra-sin-dato" aria-label="Tiempo desconocido">—</span>`;
    else cifra = `<span class="cifra"><span class="cifra-num">${min === 0 ? "&lt;1" : entero(min)}</span><span class="cifra-unidad">${NBSP}min</span></span>`;
    const por = proximo.ultParadaNombre ? `va por ${esc(proximo.ultParadaNombre)}` : null;
    const sub = [dist == null ? "aún no ha salido" : distancia(dist), por].filter(Boolean).join(" · ");
    const dicho = enParada ? ", en parada" : min == null ? "" : `, ${entero(min)} ${min === 1 ? "minuto" : "minutos"}`;
    const etiqueta = `Línea ${l.nombre}${destino ? ` hacia ${destino}` : ""}${dicho}. Ver el bus en el mapa`;
    return `<a class="fila fila-llegada" href="?linea=${Number(l.id)}&amp;bus=${Number(proximo.bus)}" aria-label="${esc(etiqueta)}">
        ${insignia(l)}
        <span class="fila-texto">
            <span class="fila-titulo truncar">${destino ? `hacia ${esc(destino)}` : `Línea ${esc(l.nombre)}`}</span>
            <span class="fila-sub truncar">${enParada ? (por ?? "") : sub}</span>
        </span>
        <span class="fila-cifra">
            ${cifra}
            ${despues.length ? `<span class="fila-sub">después ${despues.join(" y ")}${NBSP}min</span>` : ""}
        </span>
    </a>`;
}
