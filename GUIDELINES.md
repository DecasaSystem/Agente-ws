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
