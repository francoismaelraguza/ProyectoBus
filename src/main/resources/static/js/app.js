// Entrada: router por URL real (?vista, ?parada, ?linea), pestañas y arranque.

import { cargarCatalogo, datos } from "./estado.js";
import { icono } from "./ui.js";
import { obtenerUbicacion } from "./geo.js";
import * as mapa from "./mapa.js";
import * as hoja from "./hoja.js";
import * as buscador from "./buscador.js";
import * as inicio from "./vistas/inicio.js";
import * as parada from "./vistas/parada.js";
import * as lineas from "./vistas/lineas.js";
import * as linea from "./vistas/linea.js";
import * as ruta from "./vistas/ruta.js";

/**
 * ÚNICO sitio donde se definen vistas y pestañas. Gana la primera que coincide.
 * - etiqueta + href: la vista tiene pestaña propia.
 * - pestana: id de la vista cuya pestaña se marca como activa (si no se indica, la suya).
 * - abreHoja: en móvil sube la hoja al menos a «medio».
 */
const VISTAS = [
    { id: "parada", coincide: (p) => p.has("parada"), modulo: parada, pestana: "inicio", abreHoja: true },
    { id: "linea", coincide: (p) => p.has("linea"), modulo: linea, pestana: "lineas", abreHoja: true },
    { id: "lineas", coincide: (p) => p.get("vista") === "lineas", modulo: lineas, etiqueta: "Líneas", href: "?vista=lineas", orden: 1 },
    { id: "ruta", coincide: (p) => p.get("vista") === "ruta", modulo: ruta, etiqueta: "Ruta", href: "?vista=ruta", orden: 2, abreHoja: true },
    { id: "inicio", coincide: () => true, modulo: inicio, etiqueta: "Paradas", href: "/", orden: 0 },
];

const contenedor = document.querySelector("#vista");
const navPestanas = document.querySelector("#pestanas");
let actual = null;        // { destruir }
let idActual = null;
let ficha = 0;            // descarta renders obsoletos

// ---------- Navegación ----------

function navegar(url, { reemplazar = false } = {}) {
    const destino = new URL(url, location.href);
    if (destino.origin !== location.origin) return;
    const igual = destino.pathname + destino.search === location.pathname + location.search;
    if (!igual) history[reemplazar ? "replaceState" : "pushState"](null, "", destino.pathname + destino.search);
    pintar({ reiniciarScroll: !igual });
}

document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const href = a.getAttribute("href");
    if (href.startsWith("#")) return;
    const url = new URL(a.href);
    if (url.origin !== location.origin || url.pathname !== "/") return;
    e.preventDefault();
    navegar(url.pathname + url.search);
});

window.addEventListener("popstate", () => pintar({ reiniciarScroll: false }));

// ---------- Pestañas ----------

function pintarPestanas(vistaActiva) {
    const activa = vistaActiva.pestana ?? vistaActiva.id;
    navPestanas.innerHTML = VISTAS.filter((v) => v.etiqueta).sort((a, b) => a.orden - b.orden).map((v) =>
        `<a class="pestana" href="${v.href}"${v.id === activa ? ' aria-current="page"' : ""}>${v.etiqueta}</a>`
    ).join("");
}

// ---------- Render de la vista ----------

async function pintar({ reiniciarScroll = true } = {}) {
    const mia = ++ficha;
    actual?.destruir?.();
    actual = null;

    const params = new URLSearchParams(location.search);
    const vista = VISTAS.find((v) => v.coincide(params));
    pintarPestanas(vista);
    document.querySelector("#panel").dataset.detalle = vista.abreHoja && !vista.etiqueta ? "1" : "0";
    if (vista.abreHoja) hoja.subirAlMenosA("medio");

    try {
        await cargarCatalogo();
    } catch {
        contenedor.innerHTML = `<h1>Paradas</h1><div class="tarjeta" role="alert"><div class="fila fila-error"><p>No se pudo cargar el catálogo de líneas y paradas.</p><button type="button" class="boton-texto" id="reintentar-catalogo">Reintentar</button></div></div>`;
        contenedor.querySelector("#reintentar-catalogo").addEventListener("click", () => pintar());
        return;
    }
    if (mia !== ficha) return;

    if (!mapaConParadas) {
        mapa.pintarParadas(datos.paradas);
        mapaConParadas = true;
    }
    const nueva = vista.modulo.montar({ contenedor, params, navegar });
    actual = (await nueva) ?? null;
    if (mia !== ficha) {
        actual?.destruir?.();
        return;
    }
    idActual = vista.id;
    if (reiniciarScroll) {
        contenedor.scrollTop = 0;
        contenedor.querySelector("h1")?.setAttribute("tabindex", "-1");
        if (primeraVez) primeraVez = false;
        else contenedor.querySelector("h1")?.focus({ preventScroll: true });
    }
}

let mapaConParadas = false;
let primeraVez = true;

// ---------- Arranque ----------

hoja.iniciar(document.querySelector("#panel"), document.querySelector("#asa"));

mapa.iniciar(document.querySelector("#mapa"), {
    alClicParada: (id) => navegar(`?parada=${id}`),
    obtenerRelleno: hoja.alturaTapada,
    botonUbicacion: document.querySelector("#btn-ubicacion"),
});

document.querySelector(".buscador-icono").innerHTML = icono("lupa");

buscador.iniciar({
    input: document.querySelector("#buscar"),
    resultados: document.querySelector("#resultados"),
    estado: document.querySelector("#resultados-estado"),
    alElegir: (href) => navegar(href),
    alEnfocar: () => hoja.subirAlMenosA("medio"),
});

const avisoMapa = document.querySelector("#aviso-mapa");
let temporizadorAviso = null;
function avisarEnMapa(texto) {
    avisoMapa.textContent = texto;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => { avisoMapa.textContent = ""; }, 5000);
}

const btnUbicacion = document.querySelector("#btn-ubicacion");
btnUbicacion.innerHTML = icono("ubicacion", { tam: 20 });
btnUbicacion.addEventListener("click", async () => {
    try {
        const pos = await obtenerUbicacion();
        mapa.marcarUsuario(pos);
        mapa.volarA(pos, 16);
    } catch {
        avisarEnMapa("No se pudo obtener tu ubicación. Activa el permiso en el navegador.");
    }
});

hoja.alCambiar(() => mapa.invalidarTamano());
window.addEventListener("resize", () => mapa.invalidarTamano());

pintar({ reiniciarScroll: false });
