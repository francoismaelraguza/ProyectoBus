// Llamadas a nuestro backend (/api).

export class ErrorApi extends Error {
    constructor(mensaje, estado = 0) {
        super(mensaje);
        this.name = "ErrorApi";
        this.estado = estado;
    }
}

async function pedir(url, { signal } = {}) {
    let respuesta;
    try {
        respuesta = await fetch(url, { signal, headers: { Accept: "application/json" } });
    } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new ErrorApi("Sin conexión con el servidor");
    }
    if (!respuesta.ok) throw new ErrorApi(`Error ${respuesta.status}`, respuesta.status);
    try {
        return await respuesta.json();
    } catch {
        throw new ErrorApi("Respuesta no válida", respuesta.status);
    }
}

export const catalogo = (opciones) => pedir("/api/catalogo", opciones);
export const llegadas = (paradaId, opciones) => pedir(`/api/paradas/${paradaId}/llegadas`, opciones);
export const recorrido = (lineaId, opciones) => pedir(`/api/lineas/${lineaId}/recorrido`, opciones);
export const ruta = (origen, destino, opciones) => pedir(`/api/ruta?origen=${origen}&destino=${destino}`, opciones);
