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
     * minutos/distancia: lo que falta hasta la parada consultada.
     * ultParada*: la última parada por la que pasó (sirve para situarlo en el mapa).
     */
    public record BusLlegada(int bus, int minutos, int distancia, int estado,
                             Integer ultParadaId, String ultParadaNombre, Double lat, Double lng) {
    }
}
