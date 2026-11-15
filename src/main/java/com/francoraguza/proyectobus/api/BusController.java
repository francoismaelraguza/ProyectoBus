package com.francoraguza.proyectobus.api;

import com.francoraguza.proyectobus.api.ApiDtos.Catalogo;
import com.francoraguza.proyectobus.api.ApiDtos.BusesLinea;
import com.francoraguza.proyectobus.api.ApiDtos.LlegadasParada;
import com.francoraguza.proyectobus.api.ApiDtos.PlanRuta;
import com.francoraguza.proyectobus.api.ApiDtos.RecorridoLinea;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class BusController {

    private final BusService service;
    private final PlanificadorService planificador;

    public BusController(BusService service, PlanificadorService planificador) {
        this.service = service;
        this.planificador = planificador;
    }

    /** Líneas (con colores y recorridos) y paradas (con coordenadas). */
    @GetMapping("/catalogo")
    public Catalogo catalogo() {
        return service.catalogo();
    }

    /** Buses que llegan a una parada, con tiempo, distancia y última parada. */
    @GetMapping("/paradas/{id}/llegadas")
    public LlegadasParada llegadas(@PathVariable int id) {
        return service.llegadas(id);
    }

    /** Paradas ordenadas y trazado por calles de cada sentido de una línea. */
    @GetMapping("/lineas/{id}/recorrido")
    public RecorridoLinea recorrido(@PathVariable int id) {
        return service.recorrido(id);
    }

    /** Qué buses coger para ir de una parada a otra (directo o con trasbordos). */
    @GetMapping("/ruta")
    public PlanRuta ruta(@RequestParam int origen, @RequestParam int destino) {
        return planificador.planificar(origen, destino);
    }

    /** Buses de una línea ahora mismo: GPS, última parada, estado y avance. */
    @GetMapping("/lineas/{id}/buses")
    public BusesLinea buses(@PathVariable int id) {
        return service.busesLinea(id);
    }
}
