# Agentews — DeCasa WhatsApp Bot

Agente de WhatsApp para la tienda de muebles **DeCasa**. Maneja ventas, dudas de productos, agendamiento de citas y visualización de muebles en fotos del cliente. Usa Twilio (WA), Gemini 2.5-flash-lite (AI), MySQL (estado), Telegram (notificaciones al asesor).

---

## Archivos clave

| Archivo | Rol |
|---|---|
| `index.js` | Todo el webhook (~2600 líneas). Lógica principal, detección de intenciones, flujo de ventas, agenda. |
| `db.js` | Capa de base de datos (~727 líneas). CRUD para usuarios, conversaciones, estado, pedidos, citas. |
| `utils.js` | Helpers: normalización de texto, formateo de precios, parsing. |
| `image-processor.js` | Replicate (Flux Kontext Pro) + Cloudinary: superpone muebles sobre foto del cliente. |
| `knowledge.json` | Inventario completo: 14 categorías, ~200 productos con nombre, medidas, material, precio, imagen. |
| `init-db.js` | Inicialización del esquema MySQL. **ADVERTENCIA: le faltan columnas (ver bugs críticos).** |

---

## Arquitectura: flujo de un mensaje

```
POST /webhook (Twilio)
  → Rate limit (1.5s cooldown por teléfono, Map en memoria)
  → Obtener/crear usuario en DB
  → Limpiar estado si inactividad > 45 min
  → Detectar tipo de mensaje:
      saludo puro           → SALUDO_INICIAL
      pedir catálogo        → enviar PDF
      imagen recibida       → image-processor.js
      pedir asesor          → notificar Telegram, marcar transferido=true
      flujo de agenda       → máquina de estados (paso_agenda 1-6)
      ver/editar carrito    → gestión carrito
      objeción de precio    → buscar alternativa más barata
      búsqueda de producto  → buscarProductoPorNombre() + scoring
      comparación           → guardar comparacion_productos
      intención de compra   → confirmar pedido
      mensaje genérico      → callGemini()
  → Guardar mensajes en conversaciones (ventana 12 mensajes)
  → Responder via Twilio
```

---

## Estado por usuario: tabla `estado_usuario`

Estos son TODOS los campos usados en el código. Algunos no están en `init-db.js` (ver bugs):

```sql
categoria_actual          VARCHAR   -- categoría activa del usuario
producto_pendiente        TEXT      -- JSON del producto esperando confirmación
carrito                   TEXT      -- JSON array de items
transferido               BOOLEAN   -- ya fue transferido a asesor
greeting_sent             BOOLEAN   -- ya recibió saludo inicial
tiene_pedido              BOOLEAN   -- tiene pedido confirmado
agendando_cita            BOOLEAN   -- está en flujo de agenda
paso_agenda               INT       -- paso actual 1-6 del flujo de agenda
datos_agenda              TEXT      -- JSON {nombre, ubicacion, dia, hora, razon, esSabado}
candidatos_pendientes     TEXT      -- JSON array de productos ambiguos
subtipo_pendiente         VARCHAR   -- 'sillas' o 'mesas', pide subtipo
comparacion_productos     TEXT      -- JSON de productos en comparación  ← FALTA EN INIT-DB
comparacion_pendiente     TIMESTAMP -- cuándo empezó la comparación (timeout 15 min)
ultimo_producto           TEXT      -- JSON del último producto visto
transferencia_medida_pendiente TEXT -- JSON pedido de personalización pendiente
```

---

## Flujo de agenda (6 pasos)

| Paso | Qué pide | Validación |
|---|---|---|
| 1 | Nombre completo | no vacío |
| 2 | Sede (5 opciones) | número 1-5 |
| 3 | Día (L-V) | texto día o número |
| 4 | Hora | 8am-5pm, sáb 8am-12pm |
| 5 | Motivo de visita | texto libre |
| 6 | Confirmar resumen | "sí" / "cancelar" |

Cancelar en cualquier paso: escribe "cancelar".

---

## Flujo de compra

```
Usuario ve producto → producto_pendiente = producto
"sí"/"quiero"/"me lo llevo" → agregar a carrito (max 10)
"ver carrito" → mostrar items + total
"confirmo" (con items en carrito) → crear pedido en DB + notificar Telegram
```

**Triggers de compra EXPLÍCITOS** (no confundir con afirmaciones genéricas):
`me lo llevo`, `confirmar compra`, `comprar ahora`, `lo tomo`, `confirmar pedido`, `quiero comprarlo`, `hacer pedido`

---

## Gemini: reglas de uso

- Modelo: `gemini-2.5-flash-lite`, temperatura 0.8, max 600 tokens
- El system prompt incluye TODO el inventario de `knowledge.json`
- Ventana de contexto: últimas 12 conversaciones del usuario
- **Validar siempre la respuesta**: si detecta señales de incertidumbre (`no tengo información`, precios inventados) → agregar mensaje de fallback manual
- La función `callGemini()` puede lanzar excepciones; siempre envolver en try/catch

---

## Notificaciones Telegram

Tipos enviados al asesor:
- `asesor` — usuario pidió hablar con un humano
- `pedido` — pedido confirmado (incluye productos + total)
- `personalizacion` — cliente quiere medida/color especial
- `cita` — cita agendada (incluye datos completos)

Incluyen las últimas 6 conversaciones y un link directo de WhatsApp.

---

## Bugs críticos conocidos

### BUG 1 — Syntax error en `detectarConsultaInfo()` (index.js ~línea 920)
```javascript
// MAL (=> en lugar de =)
if (patrones => patrones.some(p => p.test(msg))) {
// BIEN
if (patrones.some(p => p.test(msg))) {
```
**Efecto:** El servidor puede crashear o la función retorna siempre truthy.

### BUG 2 — Columnas faltantes en `init-db.js`
`comparacion_productos` y `comparacion_pendiente` se usan en el código pero no están en el CREATE TABLE de `estado_usuario`. Si se reinicializa la DB, esas columnas no existirán y el código fallará.

**Fix:** Agregar a `init-db.js`:
```sql
comparacion_productos TEXT,
comparacion_pendiente TIMESTAMP NULL DEFAULT NULL,
```

### BUG 3 — `image-processor.js` sin fallback real
Si Replicate se queda sin créditos, el error se atrapa pero el usuario recibe un mensaje genérico sin contexto útil. El flujo de imagen se cuelga silenciosamente.

### BUG 4 — Rate limiting no persiste reinicios
El `Map` de rate limiting vive en memoria. Si el servidor se reinicia, se pierden todos los cooldowns activos.

---

## Reglas para editar este código

1. **No eliminar patrones de detección existentes** — solo agregar nuevos al array.
2. **Antes de tocar `index.js`**: leer la función completa, no solo las líneas del error.
3. **El scoring de `buscarProductoPorNombre()`** es delicado (0-100 puntos). Cambiar umbrales con cuidado.
4. **`parseJSONField()`** devuelve `null` silenciosamente si el JSON está corrupto — siempre verificar el resultado antes de usarlo.
5. **`estado_usuario`** se actualiza en múltiples lugares; si agregas un campo nuevo, actualízalo también en la función de limpieza de inactividad.
6. Después de cualquier cambio en `index.js`: `node -c index.js` para verificar sintaxis.
7. No duplicar funciones. Verificar con Grep antes de crear algo nuevo.

---

## Variables de entorno requeridas

```
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
GEMINI_API_KEY
DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT
REPLICATE_API_KEY
CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
PORT (default 3000)
```

---

## Testing

```bash
npm test                    # todos los tests
npm test -- tests/unit/     # solo unitarios
node -c index.js            # verificar sintaxis
```

Mocks disponibles en `tests/mocks/`: Gemini, Twilio, Cloudinary, Replicate, DB.

---

## Fuente de datos de productos

Los productos ya **no vienen de `knowledge.json`** — vienen de la BD. Flujo:

1. Al arrancar: `cargarInventario()` carga todos los productos de la tabla `productos` → variable `inventario` en `index.js`
2. `utils.setInventario(inventario)` sincroniza `utils.js`
3. Auto-refresco cada 30 min (`setInterval` en `startServer`)
4. Endpoint `POST /refresh-inventario` para forzar recarga inmediata

Lo que **sí** sigue usando `knowledge.json`:
- `knowledge.catalogos` — links a PDFs por subcategoría
- `knowledge.empresa` — info básica para el endpoint GET /webhook
- `knowledge.inventario` en `utils.js` — solo como fallback si la BD falla al arrancar

Tabla `productos` en BD: 207 productos, 15 subcategorías. Tabla `categorias`: 4 categorías top-level.

## Estado actual del proyecto (mayo 2026)

- Flujo de ventas: funcional
- Flujo de agenda: funcional
- Imagen AI: funcional si hay créditos en Replicate
- Comparación de productos: implementada, puede tener edge cases
- Subtipo de sillas/mesas: implementado
- Personalización: detectada y enviada a asesor
- Inventario: migrado a BD, agente lee desde BD en tiempo real
- **Bugs corregidos:** syntax error detectarConsultaInfo, columnas faltantes init-db.js, fallback imagen Replicate
