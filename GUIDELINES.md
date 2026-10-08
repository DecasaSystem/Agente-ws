# Guidelines para modificar el agente DeCasa

## Reglas generales

1. **NO eliminar código existente a menos que sea absolutamente necesario** — fijarse que no se duplique código al añadir algo
2. **Ante la duda, añadir o modificar en lugar de eliminar**
3. **Mantener la coherencia del código** — no dejar funciones huérfanas o sin uso
4. **Verificar que las funciones siguen existiendo** antes de llamarlas
5. **Leer la función completa** antes de editarla, no solo las líneas del error

---

## Antes de hacer una edición

- ✅ Revisar si la función que voy a modificar existe (Grep primero)
- ✅ Verificar que no estoy reemplazando código que se usa en otra parte
- ✅ Comprobar que no creo funciones duplicadas
- ✅ Si toco `index.js`: leer al menos 30 líneas de contexto arriba y abajo del cambio

---

## Si necesito eliminar algo

- ✅ Eliminar solo lo mínimo indispensable
- ✅ Verificar que no haya referencias a esa función en el código
- ✅ Si hay referencias, eliminarlas también o reemplazarlas por algo equivalente

---

## Después de hacer cambios

- ✅ Verificar sintaxis con `node -c index.js` (o el archivo modificado)
- ✅ Probar el código si es posible
- ✅ Documentar el cambio con un comentario inline si el motivo no es obvio

---

## Reglas específicas por sección

### Patrones de detección (detectar*)

**NO eliminar patrones existentes.** Solo añadir al final del array:

```javascript
// MALO
const patrones = [/nuevo_patron/i]; // reemplaza todo

// BUENO
const patrones = [
  /patron_existente_1/i,
  /patron_existente_2/i,
  /nuevo_patron/i,  // <-- añadido
];
```

### Sistema de scoring (`buscarProductoPorNombre`)

- El algoritmo da 0-100 puntos. El umbral mínimo es 30.
- Cambiar umbrales solo si hay evidencia de falsos positivos/negativos concretos.
- No tocar la lógica de `esFraseCompraGenerica()` sin revisar todos sus usos.

### Estado de usuario (`estado_usuario`)

- Si agregas un campo nuevo: también agregarlo en `init-db.js` Y en la función de limpieza de inactividad.
- Siempre usar `parseJSONField()` para leer campos JSON — nunca `JSON.parse()` directo.
- Verificar que `parseJSONField()` no retornó `null` antes de operar sobre el resultado.

### Gemini (`callGemini`)

- Siempre envolver en try/catch.
- Si la respuesta contiene señales de incertidumbre, no bloquear — agregar fallback al final del mensaje.
- No aumentar `maxOutputTokens` sin medir el impacto en costo.

### Base de datos

- No modificar el esquema sin actualizar `init-db.js` también.
- Campos actuales de `estado_usuario` que deben existir (incluye los que fallaban):
  `categoria_actual, producto_pendiente, carrito, transferido, greeting_sent, tiene_pedido, agendando_cita, paso_agenda, datos_agenda, candidatos_pendientes, subtipo_pendiente, comparacion_productos, comparacion_pendiente, ultimo_producto, transferencia_medida_pendiente`

### Flujo de agenda (pasos 1-6)

- El flujo avanza por `paso_agenda` (1 a 6). Cada paso tiene validación específica.
- Si se añade un paso nuevo, actualizar también el mensaje de resumen del paso 6.
- "cancelar" debe funcionar en cualquier paso — no romper esa comprobación.

### Notificaciones Telegram

- Los tipos válidos son: `asesor`, `pedido`, `personalizacion`, `cita`.
- Si se añade un tipo nuevo, documentarlo aquí y en CLAUDE.md.

---

## Bugs conocidos (no re-introducir)

**FIX #1 — Rate limiting** (evitar múltiples llamadas a Gemini por mensajes rápidos)
- Solución activa: `Map` en memoria con cooldown 1.5s por teléfono.
- No eliminar esa verificación.

**FIX #2 — Intención de compra genérica** (afirmaciones como "muy bien" no deben comprar)
- Solución activa: triggers explícitos únicamente.
- Si añades triggers nuevos, que sean inequívocos.

**FIX #3 — Objeción de precio** (ofrecer alternativa más barata)
- Solución activa: detectar keywords de precio alto + buscar alternativa en misma categoría.

**FIX #4 — Validación de respuesta Gemini** (evitar precios inventados)
- Solución activa: detectar señales de incertidumbre y agregar fallback.

**BUG PENDIENTE #1** — `detectarConsultaInfo()` ~línea 920: `=>` en lugar de `=` en asignación.

**BUG PENDIENTE #2** — `init-db.js` le faltan `comparacion_productos` y `comparacion_pendiente` en el CREATE TABLE.

**BUG PENDIENTE #3** — `image-processor.js` no tiene fallback si Replicate se queda sin créditos.

---

## Ejemplo de buena práctica

```javascript
// MALO: reemplazar todo el cuerpo
function detectarVerCarrito(mensaje) {
  return /carrito/i.test(mensaje);
}

// BUENO: añadir sin romper lo existente
function detectarVerCarrito(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /ver.*carrito/i,
    /mi carrito/i,
    /mi compra/i,      // existente
    /mostrar carrito/i // <-- nuevo
  ];
  return patrones.some(p => p.test(msg));
}
```

---

## Notas adicionales

- Este agente tiene ~2600 líneas en `index.js`. Leer antes de cambiar.
- Si algo funciona, no tocarlo por "limpiar" código.
- El inventario completo está en `knowledge.json` — no duplicar esa información en el código.
- `db.js` tiene toda la capa de datos; no escribir SQL directo en `index.js`.

---

## Cambios de la auditoría (sept 2026)

**Módulos nuevos**
- `fechas.js` — fecha de hoy en hora de Colombia (`TIMEZONE`, por defecto `America/Bogota`), lista de próximos días para el prompt, y `validarFechaHoraCita()` (fecha real, no pasada, no domingo, día de la semana coherente, hora dentro del horario). `agendar_cita` guarda además `citas_agentes.fecha` (DATE) y rechaza duplicados del mismo día.
- `vision-catalogo.js` — identificación visual por categoría: clasifica el mueble de la foto (GPT-4o a baja resolución) y lo compara SOLO con las miniaturas de los productos de esa categoría. Se ejecuta después del dHash en `analizarImagenCliente`. Umbrales: ≥85 "es este", 60-84 "se parece a", <60 no identificado. Evento `vision_catalogo` en `wa_eventos`.

**Reglas nuevas**
- El precio del carrito SIEMPRE sale de la BD (`resolverProductoExacto` + variante). Si el modelo pasa otro precio se alerta por Telegram.
- `encontrarVariante` solo acepta coincidencias parciales inequívocas ("2" ya no elige "1.20").
- `/refresh-inventario`, `/admin/resumen`, `/citas/:id/estado` exigen `X-Agent-Token` (= `DECASA_AGENT_TOKEN`).
- Historial ordenado por `id` (no por `created_at`).

**Variables de entorno nuevas (opcionales)**
- `COMPRAS_WHATSAPP` — número del encargado de compras que se incluye en las notificaciones de proveedor (antes iba en el código).
- `OPENAI_VISION_MODEL` — modelo para la identificación visual (por defecto el de `OPENAI_MODEL`).
- `TIMEZONE` — zona horaria del negocio.

**Pendiente que requiere tu acción**
- `baseDatos.sql` contiene el host de Aiven y teléfonos reales de clientes: bórralo del proyecto (o muévelo fuera) antes de compartir el código.

---

## Segunda tanda de la auditoría (P1/P2)

**Retención de contexto (reemplaza el borrado a los 45 min)**
- `VENTANA_CONVERSACION_MINUTOS` (45): solo cierra flujos a medias (`limpiarFlujosEnCurso`). El carrito, el último producto y el historial se conservan.
- `TIMEOUT_CARRITO_HORAS` (72): a partir de aquí sí se descarta carrito e historial.
- `RETENCION_HISTORIAL_DIAS` (90): barrido de fondo (`limpiarHistorialAntiguo`), como en Instagram.
- `confirmar_pedido` y `transferir_asesor` YA NO borran el historial. El pedido solo vacía el carrito.
- `consumirReactivacionAsesor` devuelve `{ atendido }` (o null): si nadie tomó la tarjeta, Elena se disculpa por la demora en vez de preguntar "¿cómo te fue con el asesor?".
- Si el cliente vuelve tras ≥45 min se inyecta una nota de regreso (medida al entrar el turno, antes de refrescar `last_interaction`).

**Otros**
- Saludo de bienvenida solo en el primer mensaje (antes se repetía con cualquier "buenas").
- Adjuntos que no podemos leer (video, PDF, contacto, ubicación) reciben una respuesta útil; si vienen con texto, el texto se atiende igual.
- `quitar_del_carrito` exige coincidencia inequívoca: con dos sofás en el carrito, "quita el sofá" pregunta cuál en vez de borrar los dos.
- Reintentos con backoff para OpenAI (`reintentos.js`) y `temperature` 0.7 → 0.3.
- Una caída de OpenAI ya no genera una tarjeta por cliente: se pide paciencia y solo se escala si vuelve a fallar en los 10 min siguientes.
- Dedup durable de SIDs en `wa_sids_procesados` (antes solo en memoria: un redeploy provocaba respuestas duplicadas). Falla "abierto": ante duda, procesa.

---

## Tercera tanda (cierre de P1)

**Cancelar y mover citas** — tool nueva `cancelar_cita`
- `db.getCitasVigentes()` (no canceladas, de hoy en adelante) y `db.cancelarCita(telefono, id)`, que valida el id contra el teléfono del cliente.
- Sin id y con una sola cita la cancela; con varias devuelve la lista para que Elena pregunte; nunca cancela a ciegas.
- Notifica la cancelación al panel (`tipo: 'cita'`, `datos_cita.cancelada = true`): antes el asesor preparaba el producto y esperaba a un cliente que ya había avisado.
- Para CAMBIAR una cita: `cancelar_cita` y luego `agendar_cita` con la fecha nueva (regla en el prompt).
- `consultar_estado` devuelve el `id` de cada cita para que el modelo pueda referenciarla.

**Entrega de la respuesta**
- `enviarTexto` devuelve true/false, reintenta con backoff y alerta si Twilio rechaza el envío.
- La respuesta entra al historial SOLO si se entregó (texto, imagen y audio). Antes se guardaba como dicha aunque Twilio fallara, y al turno siguiente Elena la daba por dicha.
- Un saludo que no se pudo entregar no se marca como enviado: el siguiente mensaje vuelve a contar como primer contacto.

**Notificaciones al sistema de ventas**
- Los leads de proveedor se envían con `tipo: 'asesor'` (antes `'otro'`, que no está entre los tipos válidos y podía ser rechazado con un 4xx; la naturaleza va en el resumen).
- Un rechazo permanente (4xx salvo 408/429) se alerta al primer intento en vez de reintentarse durante más de un día.

---

## Cuarta tanda: configuración por negocio (multi-cliente)

**Los datos del negocio salieron del código.** Ver `DESPLEGAR-NUEVO-CLIENTE.md` en la raíz.

- `negocio.json` — nombre, sedes, horario, categorías, políticas de pago/envío/descuento, servicios, estilo, saludos y ventanas de operación. Ruta alternativa con `NEGOCIO_CONFIG`.
- `negocio.js` — carga y valida la config (si falta un campo obligatorio el agente NO arranca) y expone `UBICACIONES`, `SEDE_NOMBRE`, `SEDE_TIENDA_ID`, `CATEGORIAS`, `sedeValida()`, `formatearMoneda()`, timeouts, etc.
- `prompt.js` — genera el system prompt desde la config, con las diferencias por canal (`whatsapp` / `instagram`): nombre de la tool de transferencia, carrusel, nota de canal. **Reemplaza los dos prompts escritos a mano** (~165 líneas cada uno) que ya habían divergido.
- Los bloques opcionales desaparecen del prompt si el negocio no los tiene (no fabrica a medida, no hace restauraciones, no oculta stock por tienda).

Ya salen de la config: sedes, categorías y sus nombres, horario y todos sus textos, zona horaria, locale de moneda, margen de cierre, límite del carrito, validación de sede, saludo inicial, textos públicos, handle de Instagram, páginas legales, etiqueta de las alertas y los logs de arranque.

**Al tocar los módulos compartidos** (`negocio.js`, `prompt.js`, `fechas.js`, `vision-catalogo.js`, `reintentos.js`) hay que copiar el cambio al otro agente: son copias idénticas salvo el `'use strict'`.

---

## Quinta tanda: núcleo compartido (core/)

Los archivos que comparten los dos agentes tienen ahora una **fuente única** en `core/` de
la raíz: `negocio.json`, `negocio.js`, `prompt.js`, `fechas.js`, `vision-catalogo.js` y
`reintentos.js`.

**No se importan con `require('../core/...')`**: cada agente se despliega por separado (su
carpeta es la raíz del servicio), así que esa ruta no existe en producción. Se copian.

Flujo de trabajo:
1. Editar el archivo **en `core/`** (llevan un aviso en la cabecera).
2. `npm run sync` desde la raíz.
3. `npm test` desde la raíz (comprueba la sincronización y corre las dos suites).

Si alguien edita la copia de un agente, el test `tests/unit/core-sincronizado.test.js`
falla y dice qué archivo y qué hacer. `npm run sync:check` hace la misma comprobación para
un hook de pre-commit o CI. El test se salta solo si `core/` no existe (deploy aislado).

Comprobado que la detección funciona: al introducir un cambio en una copia, fallan los tres
mecanismos (test de WS, test de IG y `sync:check`).

---

## Plan de mejoras — Fases 1 y 2 (ver DESPLEGAR-NUEVO-CLIENTE.md)

**Fase 1 — coste y visibilidad**
- El prompt ya no lleva dentro la fecha ni las instrucciones de visión: van como mensajes
  `system` aparte para que el prefijo (~4.400 tokens) sea idéntico entre llamadas y OpenAI
  lo cachee. `logUsoTokens` muestra el `% en caché`; si sale 0 tras el primer mensaje, algo
  variable se está colando delante del prompt estable.
- `core/vigilancia.js`: avisa si el agente deja de vender en silencio (inventario vacío,
  cero conversaciones en horario, notificaciones atascadas, token de Meta por caducar).
- `GET /stats` también en WhatsApp, con `tasa_transferencia` además del embudo.
- `clasificarImagen()` usa `OPENAI_MODEL_RAPIDO` (gpt-4o-mini); la comparación visual sigue
  con el modelo grande.

**Fase 2 — seguimiento proactivo** (`core/seguimientos.js`)
- Tabla `wa_seguimientos` y worker cada 10 min. **Tres reglas que no se tocan**: solo dentro
  de la ventana de 24 h de la plataforma, nunca por encima de un asesor humano (pospone), y
  uno por cliente y motivo (clave única).
- Recordatorios de cita (24 h y 2 h antes) que se cancelan si la cita se cancela.
- Carrito abandonado: uno solo a las 24 h, cancelado al confirmar o vaciar.
- `reportar_objecion`: avisa a ventas cuando el cliente pone un freno, SIN silenciar a la IA
  ni decírselo al cliente.
- `TWILIO_WHATSAPP_NUMBER` pasa a ser obligatoria si se usan seguimientos: esos mensajes no
  nacen de un webhook, así que no hay `To` del que sacar el número de salida.

---

## Plan de mejoras — Fase 3 (calidad medible)

- **`npm run eval`** (`core/evaluacion/`): evalúa el prompt contra el modelo REAL con 25 casos
  y catálogo sintético. Da % por categoría. No está en `npm test` porque cuesta dinero. Al
  tocar el prompt: correrlo antes y después. Cuando un cliente real reciba una mala respuesta,
  añadir ese diálogo a `casos.json`.
- **`core/memoria.js`**:
  - *Perfil* (columna `perfil`): presupuesto y productos se capturan solos de las
    herramientas; el espacio y los gustos, con `recordar_preferencia`. Se inyecta como
    contexto; un turno sin datos no borra lo anterior y las listas tienen tope.
  - *Resumen rodante* (columna `resumen_conversacion`): pasados 12 mensajes, los 8 últimos
    literales + resumen del resto con el modelo rápido, regenerado cada 6 mensajes nuevos. Se
    le pide explícitamente lo que el cliente DESCARTÓ.
- `MODELO_RAPIDO` (`OPENAI_MODEL_RAPIDO`, por defecto gpt-4o-mini) se usa para resumir y
  clasificar imágenes.

---

## Plan de mejoras — Fase 4 (operación)

- **`core/log.js`**: logs con contexto de turno (AsyncLocalStorage, sin cambiar firmas).
  `LOG_FORMATO=json` para agregadores; `log.medir()` para tiempos.
- **Tope de gasto** (`operacion.topeGastoDiarioUsd`, 1.5 por defecto): tabla
  `wa_gasto_diario` alimentada por `logUsoTokens`. Al superarlo se transfiere a un asesor
  ANTES de llamar al modelo. Ante fallo de BD se asume 0: no cortar a clientes legítimos.
- **`/health`** comprueba BD, inventario, modelo (caché 5 min) y credenciales, y devuelve
  **503** si algo falla. Antes devolvía 200 aunque la BD estuviera caída.
- **`core/migraciones.js`** + tabla `esquema_migraciones`: los cambios de esquema NUEVOS van
  en la lista `MIGRACIONES` de `init-db.js`. Se aplican una vez, quedan registrados y un error
  de SQL se ve (ya no queda tapado por un catch).
