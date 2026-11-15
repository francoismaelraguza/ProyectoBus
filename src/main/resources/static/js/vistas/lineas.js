// Vista «Líneas»: todas las líneas del catálogo.

import { datos } from "../estado.js";
import { esc, icono, insignia } from "../ui.js";
import * as mapa from "../mapa.js";

export function montar({ contenedor }) {
    document.title = "Líneas · ProyectoBus";
    mapa.limpiarRecorrido();
    mapa.limpiarBuses();
    mapa.resaltarParada(null);

    contenedor.innerHTML = `
        <h1>Líneas</h1>
        ${!datos.lineas.length ? `<p class="tarjeta-vacia">No hay líneas disponibles ahora mismo. Vuelve a intentarlo en unos minutos.</p>` : `<div class="tarjeta">${datos.lineas.map((l) =>
            `<a class="fila fila-linea" href="?linea=${Number(l.id)}">
                ${insignia(l)}
                <span class="fila-titulo truncar">${esc(l.origen)} – ${esc(l.destino)}</span>
                <span class="chevron">${icono("chevron")}</span>
            </a>`).join("")}</div>`}`;
    return { destruir() {} };
}
