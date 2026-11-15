// Vista «Aviso legal»: texto estático, sin pestaña propia (se llega desde el pie del panel).

import { icono } from "../ui.js";
import * as mapa from "../mapa.js";

const EXT = 'target="_blank" rel="noopener"';
const enlace = (url, texto) => `<a href="${url}" ${EXT}>${texto}</a>`;
const nt = (texto) => `<span translate="no">${texto}</span>`;

const SECCIONES = [
    ["Qué es esto",
        `${nt("ProyectoBus")} es un proyecto personal y educativo, sin ánimo de lucro y sin publicidad. Lo hace Franco Raguza como práctica de desarrollo web.`],
    ["No es un servicio oficial",
        `Esta web no tiene relación, patrocinio ni aprobación de la Compañía de Tranvías de La Coruña, S.A. ni del Concello da Coruña. El nombre «${nt("iTranvías")}» se menciona únicamente para indicar de dónde proceden los datos; las marcas y nombres pertenecen a sus titulares.`],
    ["De dónde salen los datos",
        `Las líneas, las paradas, los tiempos de llegada y la posición de los buses se consultan en el momento al servicio público ${nt("iTranvías")}. Pueden llegar con retraso, estar incompletos o dejar de estar disponibles sin aviso. La información válida es la de los canales oficiales: ${enlace("https://itranvias.com/", "itranvias.com")} y ${enlace("https://tranviascoruna.com/", "tranviascoruna.com")}. Las rutas del planificador son estimaciones calculadas por esta web, no horarios oficiales.`],
    ["Sin garantía",
        "La información se ofrece tal cual, sin garantía de exactitud ni de disponibilidad. El autor no se hace responsable de las decisiones que se tomen a partir de ella. Comprueba siempre los tiempos en la parada o en los canales oficiales."],
    ["Corrección o retirada",
        `Si eres titular de algún dato o contenido que aparece aquí y quieres que se corrija o se retire, abre una incidencia en ${enlace("https://github.com/francoismaelraguza/ProyectoBus/issues", "el repositorio del proyecto")}. Se atenderá lo antes posible.`],
    ["Privacidad",
        `Esta web no usa cookies ni herramientas de analítica y no pide registro. Tus paradas favoritas se guardan solo en este dispositivo (almacenamiento local del navegador) y puedes borrarlas quitando la estrella o limpiando los datos del sitio. Si usas «Usar mi ubicación», tu posición se utiliza únicamente en tu navegador para ordenar las paradas cercanas: no se envía a ningún servidor. Las imágenes del mapa las sirve ${nt("CARTO")}, que recibe la dirección IP de tu conexión como cualquier servidor web; la fuente y el resto del código se sirven desde esta misma web.`],
    ["Créditos",
        `Mapa: © colaboradores de ${enlace("https://www.openstreetmap.org/copyright", nt("OpenStreetMap"))} (ODbL) y © ${enlace("https://carto.com/attributions", nt("CARTO"))}. Biblioteca de mapas: ${enlace("https://leafletjs.com/", nt("Leaflet"))} (licencia BSD de 2 cláusulas). Tipografía: ${nt("Geist")} (SIL Open Font License 1.1). Código del proyecto: ${enlace("https://github.com/francoismaelraguza/ProyectoBus", nt("GitHub"))}.`],
];

export function montar({ contenedor }) {
    document.title = "Aviso legal · ProyectoBus";
    mapa.limpiarRecorrido();
    mapa.limpiarBuses();
    mapa.resaltarParada(null);

    contenedor.innerHTML = `
        <div class="detalle aviso-legal">
            <a class="volver" href="/">${icono("atras")}<span>Paradas</span></a>
            <h1>Aviso legal</h1>
            ${SECCIONES.map(([titulo, texto]) => `<section class="tarjeta aviso-seccion"><h2>${titulo}</h2><p>${texto}</p></section>`).join("")}
        </div>`;
    return { destruir() {} };
}
