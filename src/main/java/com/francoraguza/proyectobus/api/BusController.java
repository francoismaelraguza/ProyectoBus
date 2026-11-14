package com.francoraguza.proyectobus.api;

import com.francoraguza.proyectobus.api.ApiDtos.Catalogo;
import com.francoraguza.proyectobus.api.ApiDtos.LlegadasParada;
import com.francoraguza.proyectobus.api.ApiDtos.RecorridoLinea;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class BusController {

    private final BusService service;

    public BusController(BusService service) {
        this.service = service;
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
}
