# Grand Theft Sant Boi

Juego de acción en el navegador ambientado en **Sant Boi de Llobregat** con sus calles reales.
Tiene **vista 3D en tercera persona** (cámara detrás del coche o del personaje, como los GTA
modernos), con los edificios levantados a su altura real, y también una **vista cenital** clásica
tipo GTA 1/2. Se cambia de una a otra con la tecla `C`. Las calles, los edificios, los parques, el río
Llobregat, las vías del tren y los barrios salen de [OpenStreetMap](https://www.openstreetmap.org).

## Cómo jugar

No hay que instalar nada: es HTML + JavaScript, sin dependencias.

- **En local:** abre `index.html` en el navegador (Chrome, Firefox, Edge o Safari).
- **Online:** activa GitHub Pages en *Settings → Pages* (rama `main`, carpeta `/`) y abre la URL que te da.

La primera vez el juego descarga el mapa de Sant Boi desde la API Overpass de OpenStreetMap
(puede tardar entre 10 y 60 segundos) y lo guarda en el navegador (IndexedDB). Las siguientes
veces arranca al momento. Si no hay conexión, puedes jugar con un mapa aproximado.

### Controles

| Acción | Teclado |
| --- | --- |
| Moverse / conducir | `WASD` o flechas |
| Correr (a pie) | `Shift` |
| Disparar (a pie) / freno de mano (en coche) | `Espacio` |
| Robar un coche / bajar | `E` |
| Claxon | `H` |
| Cambiar cámara 3D / desde arriba | `C` |
| Mapa completo | `M` |
| Pausa | `P` o `Esc` |

En la vista 3D, a pie, `A`/`D` giran al personaje y `W`/`S` lo mueven adelante y atrás.
En el móvil salen un joystick y unos botones táctiles.

### Qué hay en el juego

- **Calles reales:** el HUD muestra la calle y el barrio en el que estás (Marianao, Casablanca, Camps Blancs…).
- **Tráfico** que circula por la derecha y respeta las calles de sentido único, además de **peatones** por las aceras y coches aparcados.
- **Vehículos:** compactos, berlinas, furgonetas, taxis de Barcelona (negros y amarillos), deportivos y motos.
- **Nivel de búsqueda** de 1 a 5 estrellas. La policía te persigue por las calles y, a partir de 3 estrellas, te dispara.
  Si te pierden de vista un rato, las estrellas bajan.
- **Misiones:** pisa los círculos verdes **M** para aceptar entregas contrarreloj, robos de coches y carreras ilegales por Sant Boi.
- **WASTED / BUSTED:** apareces en el hospital o en comisaría, y pierdes algo de dinero.

### Mapa desde archivo

Si la API Overpass no responde, puedes descargar el mapa a mano en <https://overpass-turbo.eu>
con la consulta de `js/data.js` (función `buildQuery`), exportarlo como JSON y cargarlo con el
botón **Cargar JSON de Overpass** de la pantalla de inicio.

## Estructura

- `js/data.js`: descarga y procesa los datos de OpenStreetMap y genera el mapa de reserva.
- `js/render3d.js`: vista 3D con Three.js (edificios extruidos, árboles, coches, peatones y cámara de persecución).
- `js/vendor/three.min.js`: Three.js r149 (licencia MIT).
- `js/world.js`: índices espaciales, grafo de calles, colisiones y render del mapa por teselas.
- `js/game.js`: jugador, física de coches, IA de tráfico, peatones, policía, misiones y HUD.
- `js/audio.js`: efectos de sonido sintetizados con WebAudio.
- `js/main.js`: pantalla de título, controles y bucle principal.

Datos del mapa © colaboradores de OpenStreetMap, bajo licencia ODbL.
