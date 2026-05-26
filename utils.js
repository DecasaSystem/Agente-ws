const knowledge = require('./knowledge.json');

let _inventario = null;

function setInventario(inv) {
  _inventario = inv;
}

function _inv() {
  return _inventario || {};
}

// ─────────────────────────────────────────────
// INVENTARIO
// ─────────────────────────────────────────────

const generarInventarioTexto = () => {
  let texto = '\n\n=== INVENTARIO DE PRODUCTOS ===\n';
  const categorias = Object.values(_inv());
  for (const categoria of categorias) {
    texto += `\n${categoria.nombre}:\n`;
    for (const producto of categoria.productos) {
      texto += `- ${producto.nombre} | Material: ${producto.material} | Precio: ${producto.precio}\n`;
    }
  }
  return texto;
};

// ─────────────────────────────────────────────
// BÚSQUEDAS
// ─────────────────────────────────────────────

function buscarMasBarato(categoria) {
  const inventario = _inv();
  const productos = inventario[categoria]?.productos;
  if (!productos || productos.length === 0) return null;
  const sorted = [...productos].sort((a, b) => {
    const precioA = parseInt(String(a.precio).replace(/[^0-9]/g, '')) || 0;
    const precioB = parseInt(String(b.precio).replace(/[^0-9]/g, '')) || 0;
    return precioA - precioB;
  });
  return sorted[0];
}

function buscarProductosRelacionados(categoria, limite = 3) {
  const inventario = _inv();
  const productos = inventario[categoria]?.productos;
  if (!productos || productos.length === 0) return [];
  return productos.slice(0, limite);
}

module.exports = {
  setInventario,
  generarInventarioTexto,
  buscarMasBarato,
  buscarProductosRelacionados
};
