package com.francoraguza.proyectobus.api;

import java.util.List;

/** Lo que nuestro backend devuelve al frontend: ya limpio y con nombres claros. */
public final class ApiDtos {

    private ApiDtos() {
    }

    public record Catalogo(String actualizado, List<Linea> lineas, List<Parada> paradas) {
    }

    /** id = código interno (1400), nombre = número comercial ("14"). */
    public record Linea(int id, String nombre, String origen, String destino, String color,
                        List<List<Integer>> rutas) {
    }

    public record Parada(int id, String nombre, double lat, double lng, List<Integer> lineas) {
    }

    public record LlegadasParada(int parada, String nombre, String consultado, List<LineaLlegadas> lineas) {
    }

    public record LineaLlegadas(int id, String nombre, String color, List<BusLlegada> buses) {
    }

    /**
     * Un bus que viene hacia la parada.
     * minutos/distancia: lo que falta (null = desconocido, p. ej. un bus que aún no ha salido de cabecera) hasta la parada consultada.
     * ultParada*: la última parada por la que pasó (sirve para situarlo en el mapa).
     */
    public record BusLlegada(int bus, Integer minutos, Integer distancia, int estado,
                             Integer ultParadaId, String ultParadaNombre, Double lat, Double lng) {
    }

    public record RecorridoLinea(int linea, String nombre, String color, List<SentidoRecorrido> sentidos) {
    }

    /** trazado = lista de [lat, lng] siguiendo las calles. destino = nombre de la última parada. */
    public record SentidoRecorrido(int sentido, String destino, List<ParadaRecorrido> paradas,
                                   List<double[]> trazado) {
    }

    public record ParadaRecorrido(int id, String nombre, double lat, double lng) {
    }

    public record BusesLinea(int linea, String consultado, List<BusEnVivo> buses) {
    }

    /**
     * Un bus de la línea. lat/lng: GPS real (null si no está localizado).
     * ultParadaId: última parada por la que pasó. estado: 0 detenido, 1 en marcha, 17 en cabecera.
     * progreso: fracción 0-1 del recorrido de su sentido ya hecha.
     */
    public record BusEnVivo(int bus, int sentido, Double lat, Double lng, Integer ultParadaId,
                            Integer estado, Double progreso) {
    }
}
