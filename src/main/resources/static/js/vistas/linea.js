// Vista de una línea: sentido, datos, «termómetro» de paradas y buses en vivo.

import * as api from "../api.js";
import { datos, lineasDeParada } from "../estado.js";
import { colorSeguro, decimal, entero, esc, esqueletoFilas, icono, insignia, insignias, NBSP, tintaSobre } from "../ui.js";
import * as envivo from "../envivo.js";
import * as mapa from "../mapa.js";
import * as hoja from "../hoja.js";

const cache = new Map(); // id de línea -> recorrido
const plurales = new Intl.PluralRules("es");

export function montar({ contenedor, params }) {
    const id = Number(params.get("linea"));
    const linea = datos.lineaPorId.get(id);
    const busPedido = params.has("bus") && Number.isInteger(Number(params.get("bus"))) ? Number(params.get("bus")) : null;
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
    contenedor.innerHTML = `${cabecera}<div id="detalle" class="detalle"><div class="tarjeta">${esqueletoFilas(4)}</div></div>`;
    const detalle = contenedor.querySelector("#detalle");

    let cancelado = false;
    let control = null;
    let seguidor = null;
    let observador = null;
    let sentidoActual = null;
    let geo = null;
    let centros = [];
    let textoRecuento = null;
    const puntos = new Map();   // nº de bus -> botón del termómetro

    async function cargar() {
        detalle.innerHTML = `<div class="tarjeta">${esqueletoFilas(4)}</div>`;
        detenerEnVivo();
        control?.abort();
        control = new AbortController();
        try {
            let rec = cache.get(id);
            if (!rec) {
                rec = await api.recorrido(id, { signal: control.signal });
                cache.set(id, rec);
            }
            if (cancelado) return;
            const sentido = await elegirSentido(rec);
            if (!cancelado) pintar(rec, sentido);
        } catch (e) {
            if (e.name === "AbortError" || cancelado) return;
            detalle.innerHTML = `<div class="tarjeta"><div class="fila fila-error"><p>No se pudo consultar el recorrido de la línea.</p><button type="button" class="boton-texto" data-reintentar>Reintentar</button></div></div>`;
        }
    }

    /** Sentido pedido en la URL; si solo llega un bus, el sentido en el que va ahora. */
    async function elegirSentido(rec) {
        if (!rec.sentidos?.length) return null;
        const pedido = params.get("sentido");
        if (pedido != null) return rec.sentidos.find((s) => String(s.sentido) === pedido) ?? rec.sentidos[0];
        if (busPedido != null) {
            try {
                const r = await api.busesLinea(id, { signal: control.signal });
                const b = r.buses.find((x) => x.bus === busPedido);
                const s = b && rec.sentidos.find((x) => x.sentido === b.sentido);
                if (s) return s;
            } catch (e) {
                if (e.name === "AbortError") throw e;
            }
        }
        return rec.sentidos[0];
    }

    function detenerEnVivo() {
        seguidor?.destruir();
        seguidor = null;
        observador?.disconnect();
        observador = null;
        puntos.clear();
        ultimaLista = [];
        textoRecuento = null;
    }

    function pintar(rec, sentido) {
        if (!sentido) {
            detalle.innerHTML = `<p class="tarjeta-vacia">Esta línea no tiene recorrido publicado ahora mismo.</p>`;
            mapa.limpiarRecorrido();
            return;
        }
        sentidoActual = sentido;
        geo = envivo.preparar(sentido);
        const km = geo.total / 1000;
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
            <p class="datos-linea">${entero(sentido.paradas.length)}${NBSP}paradas · ${decimal(km)}${NBSP}km · <span id="recuento" aria-live="polite"><span class="esq esq-recuento" aria-hidden="true"></span></span></p>
            <p id="sin-buses" class="nota gris" hidden>Ahora no hay buses en este sentido.</p>
            <div id="senal" class="senal" aria-live="polite"></div>
            <div id="seguimiento" class="seguimiento" aria-live="polite"></div>
            <div class="termo-envoltorio" style="--linea:${color};--tinta-linea:${tintaSobre(color)}">
                <ol class="termometro tarjeta">${filas}</ol>
                <div class="termo-buses"></div>
            </div>`;

        document.title = `Línea ${linea.nombre} hacia ${sentido.destino} · ProyectoBus`;
        mapa.mostrarRecorrido({ color, trazado: sentido.trazado, paradas: sentido.paradas });

        const ol = detalle.querySelector(".termometro");
        medirCentros(ol);
        observador = new ResizeObserver(() => { medirCentros(ol); colocarPuntos(ultimaLista); });
        observador.observe(ol);

        seguidor = envivo.iniciar({
            lineaId: id,
            sentido: Number(sentido.sentido),
            geo,
            sentidos: rec.sentidos.map((s) => ({ sentido: Number(s.sentido), geo: s === sentido ? geo : envivo.preparar(s) })),
            color,
            seguirInicial: busPedido,
            alDatos: alDatos,
            alTermometro: (lista) => { ultimaLista = lista; colocarPuntos(lista); },
            alSenal,
            alSeleccion,
            alSeguidoPerdido,
        });
    }

    // ---------- Datos y recuento ----------

    let ultimaLista = [];

    function alDatos({ buses }) {
        const n = buses.length;
        const texto = n
            ? `<span class="recuento-n">${entero(n)}${NBSP}${plurales.select(n) === "one" ? "bus" : "buses"} ahora</span>`
            : "sin buses ahora";
        if (texto !== textoRecuento) {
            textoRecuento = texto;
            detalle.querySelector("#recuento").innerHTML = texto;
        }
        detalle.querySelector("#sin-buses").hidden = n > 0;
        const sel = seguidor?.seguido;
        if (sel != null) pintarSeguimiento(seguidor.obtener(sel));
    }

    function alSenal(perdida, consultado) {
        const el = detalle.querySelector("#senal");
        if (!perdida) {
            el.innerHTML = "";
            return;
        }
        if (textoRecuento === null) detalle.querySelector("#recuento").textContent = "";
        const ultimo = consultado ? ` Último dato: ${esc(consultado)}.` : "";
        el.innerHTML = `<div class="tarjeta"><div class="fila fila-error"><p>Sin señal de los buses.${ultimo}</p><button type="button" class="boton-texto" data-reintentar-buses>Reintentar</button></div></div>`;
    }

    // ---------- Termómetro ----------

    function medirCentros(ol) {
        centros = [...ol.children].map((li) => li.offsetTop + li.offsetHeight / 2);
    }

    function yDe(s) {
        const ps = geo.paradasS;
        if (!centros.length) return 0;
        if (s <= ps[0]) return centros[0];
        for (let i = 0; i < ps.length - 1; i++) {
            if (s < ps[i + 1]) {
                const tramo = ps[i + 1] - ps[i];
                const f = tramo > 0 ? (s - ps[i]) / tramo : 0;
                return centros[i] + f * (centros[i + 1] - centros[i]);
            }
        }
        return centros[centros.length - 1];
    }

    function colocarPuntos(lista) {
        const capa = detalle.querySelector(".termo-buses");
        if (!capa || !geo) return;
        const vigentes = new Set();
        for (const m of lista) {
            vigentes.add(m.bus);
            let b = puntos.get(m.bus);
            if (!b) {
                b = document.createElement("button");
                b.type = "button";
                b.className = "bus-termo";
                b.innerHTML = `<span class="bus-termo-punto">${icono("bus", { tam: 12 })}</span>`;
                b.addEventListener("click", () => seguidor?.seleccionar(m.bus));
                capa.append(b);
                puntos.set(m.bus, b);
            }
            const sig = envivo.siguienteParada(geo, m.s);
            b.style.transform = `translateY(${(yDe(m.s) - 22).toFixed(1)}px)`;
            b.setAttribute("aria-label", `Bus ${m.bus}, próxima parada ${sig.parada.nombre}, a ${distanciaTexto(sig.metros)}`);
            b.setAttribute("aria-pressed", String(seguidor?.seguido === m.bus));
        }
        for (const [n, b] of puntos) {
            if (!vigentes.has(n)) {
                b.remove();
                puntos.delete(n);
            }
        }
    }

    // ---------- Bus seguido ----------

    function pintarSeguimiento(modelo, aviso = null) {
        const el = detalle.querySelector("#seguimiento");
        if (!el) return;
        if (!modelo) {
            el.innerHTML = aviso ? `<p class="nota">${esc(aviso)}</p>` : "";
            return;
        }
        const sig = envivo.siguienteParada(geo, modelo.s);
        const [cifra, unidad] = partesDistancia(sig.metros);
        const espera = modelo.estado != null && modelo.estado >= 16;
        el.innerHTML = `<div class="tarjeta seguimiento-bloque">
            <div class="seg-texto"><p class="fila-titulo">Bus ${Number(modelo.bus)}</p><p class="fila-sub truncar">${espera ? "Esperando en cabecera" : `Próxima parada: ${esc(sig.parada.nombre)}`}</p></div>
            ${espera ? "" : `<span class="cifra"><span class="cifra-num">${cifra}</span><span class="cifra-unidad">${NBSP}${unidad}</span></span>`}
            <button type="button" class="boton-texto" data-dejar>Dejar de seguir</button>
        </div>`;
    }

    function alSeleccion(modelo, restaurar = false) {
        actualizarUrl(modelo ? modelo.bus : null);
        pintarSeguimiento(modelo);
        if (modelo) hoja.bajarComoMuchoA("medio");
        else if (restaurar) mapa.ajustarA(L.latLngBounds(sentidoActual.trazado));
        colocarPuntos(ultimaLista);
    }

    function alSeguidoPerdido(n) {
        actualizarUrl(null);
        pintarSeguimiento(null, `El bus ${n} ya no está en esta línea.`);
        colocarPuntos(ultimaLista);
    }

    function actualizarUrl(bus) {
        const url = new URL(location.href);
        url.searchParams.set("sentido", sentidoActual.sentido);
        if (bus == null) url.searchParams.delete("bus");
        else url.searchParams.set("bus", bus);
        history.replaceState(null, "", url.pathname + url.search);
    }

    detalle.addEventListener("click", (e) => {
        if (e.target.closest("[data-reintentar]")) cargar();
        else if (e.target.closest("[data-reintentar-buses]")) seguidor?.reintentar();
        else if (e.target.closest("[data-dejar]")) seguidor?.dejarDeSeguir();
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
            detenerEnVivo();
            mapa.limpiarRecorrido();
            mapa.resaltarParada(null);
        },
    };
}

/** «320» + «m», o «1,2» + «km». */
function partesDistancia(metros) {
    if (metros < 950) return [entero(Math.round(metros / 10) * 10), "m"];
    return [decimal(metros / 1000), "km"];
}

function distanciaTexto(metros) {
    const [cifra, unidad] = partesDistancia(metros);
    return `${cifra} ${unidad === "m" ? "metros" : "kilómetros"}`;
}

function enlaceVolver() {
    return `<a class="volver" href="?vista=lineas">${icono("atras")}<span>Líneas</span></a>`;
}
