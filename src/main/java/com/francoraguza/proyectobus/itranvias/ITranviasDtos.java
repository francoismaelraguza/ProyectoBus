package com.francoraguza.proyectobus.itranvias;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Registros que reflejan el JSON crudo de la API de iTranvías.
 * Solo se mapean los campos que usamos; el resto se ignora.
 */
public final class ITranviasDtos {

    private ITranviasDtos() {
    }

    // ---------- func=7 (catálogo de líneas y paradas) ----------

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CatalogoRespuesta(String resultado, @JsonProperty("iTranvias") ITranvias iTranvias) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ITranvias(Actualizacion actualizacion) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Actualizacion(String fecha, List<LineaRaw> lineas, List<ParadaRaw> paradas) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record LineaRaw(
            int id,
            @JsonProperty("lin_comer") String linComer,
            @JsonProperty("nombre_orig") String nombreOrig,
            @JsonProperty("nombre_dest") String nombreDest,
            String color,
            List<RutaRaw> rutas) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RutaRaw(int ruta, List<Integer> paradas) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ParadaRaw(int id, String nombre, double posx, double posy, List<Integer> enlaces) {
    }

    // ---------- func=0 (llegadas a una parada) ----------

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record LlegadasRespuesta(
            String resultado,
            @JsonProperty("fecha_peticion") String fechaPeticion,
            BusesRaw buses) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record BusesRaw(int parada, List<LineaLlegadaRaw> lineas) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record LineaLlegadaRaw(int linea, List<BusRaw> buses) {
    }

    /** tiempo y distancia llegan como texto y a veces no son números ("--", "<1"): se interpretan en el servicio. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record BusRaw(
            int bus,
            String tiempo,
            String distancia,
            int estado,
            @JsonProperty("ult_parada") int ultParada) {
    }

    // ---------- func=99 (paradas por sentido y recorrido de una línea) ----------

    /** "mapas" es un array de bloques con una sola clave cada uno (paradas, recorridos o buses). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record MapaRespuesta(String resultado, List<MapaBloque> mapas) {
    }

    /** Forma cruda: un bloque puede ser un array vacío (sin datos), así que se lee como árbol. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record MapaRespuestaCruda(String resultado, List<tools.jackson.databind.JsonNode> mapas) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record MapaBloque(List<SentidoParadasRaw> paradas, List<SentidoRecorridoRaw> recorridos,
                             List<SentidoBusesGpsRaw> buses) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SentidoParadasRaw(String sentido, List<ParadaMapaRaw> paradas) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ParadaMapaRaw(String id, String parada, double posx, double posy) {
    }

    /** recorrido: puntos "lon,lat,0" separados por espacios. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SentidoRecorridoRaw(String sentido, String recorrido) {
    }

    /** mostrar=B: buses con GPS real por sentido (posx = longitud, posy = latitud). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SentidoBusesGpsRaw(String sentido, List<BusGpsRaw> buses) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record BusGpsRaw(int bus, double posx, double posy) {
    }

    // ---------- func=2 (buses de una línea por sentido y última parada) ----------

    /** Se lee como árbol por si algún elemento no es un objeto. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record BusesLineaCruda(List<tools.jackson.databind.JsonNode> paradas) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record BusesLineaRespuesta(List<SentidoBusesRaw> paradas) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SentidoBusesRaw(String sentido, List<ParadaBusesRaw> paradas) {
    }

    /** parada = última parada por la que pasaron estos buses. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ParadaBusesRaw(String parada, List<BusLineaRaw> buses) {
    }

    /** distancia = fracción 0-1 del recorrido completo ya hecho; estado: 0 detenido, 1 en marcha, 17 en cabecera. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record BusLineaRaw(int bus, Integer estado, Double distancia) {
    }
}
