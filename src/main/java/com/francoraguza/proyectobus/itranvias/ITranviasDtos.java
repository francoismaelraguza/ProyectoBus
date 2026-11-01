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

    /** La API manda tiempo y distancia como texto ("11", "1778"); Jackson los convierte a int. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record BusRaw(
            int bus,
            int tiempo,
            int distancia,
            int estado,
            @JsonProperty("ult_parada") int ultParada) {
    }
}
