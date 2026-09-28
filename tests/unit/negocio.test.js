// La configuración del negocio vive en negocio.json y el prompt se genera desde ahí.
// Estas pruebas cubren lo que de verdad importa para vender el agente a otro cliente:
// que cambiando SOLO el archivo de configuración el agente hable del otro negocio, con
// sus sedes, su horario y sus políticas, sin tocar una línea de código.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const RUTA_ORIGINAL = process.env.NEGOCIO_CONFIG;

// Carga negocio.js y prompt.js con la configuración indicada, aislados del caché.
function cargarCon(cfg) {
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'negocio-')), 'negocio.json');
  fs.writeFileSync(ruta, JSON.stringify(cfg));
  process.env.NEGOCIO_CONFIG = ruta;
  jest.resetModules();
  const negocio = require('../../negocio');
  const { construirSystemPrompt } = require('../../prompt');
  return { negocio, construirSystemPrompt, ruta };
}

function configBase() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../../negocio.json'), 'utf8'));
}

afterEach(() => {
  if (RUTA_ORIGINAL === undefined) delete process.env.NEGOCIO_CONFIG;
  else process.env.NEGOCIO_CONFIG = RUTA_ORIGINAL;
  jest.resetModules();
});

describe('Configuración del negocio', () => {
  test('la de DeCasa se carga con sus 5 sedes y su horario', () => {
    const { negocio } = cargarCon(configBase());
    expect(negocio.nombreAsesora).toBe('Elena');
    expect(negocio.nombreEmpresa).toBe('DeCasa');
    expect(negocio.zonaHoraria).toBe('America/Bogota');
    expect(Object.keys(negocio.UBICACIONES)).toHaveLength(5);
    expect(negocio.SEDE_NOMBRE[4]).toContain('Unicentro');
    expect(negocio.sedeValida(5)).toBe(true);
    expect(negocio.sedeValida(6)).toBe(false);
    expect(negocio.horario.sabado.cierra).toBe(12);
  });

  test('falta un campo obligatorio: no arranca en silencio', () => {
    const cfg = configBase();
    delete cfg.sedes;
    expect(() => cargarCon(cfg)).toThrow(/sedes/);
  });

  test('una sede sin dirección se detecta al cargar', () => {
    const cfg = configBase();
    cfg.sedes = [{ id: 1 }];
    expect(() => cargarCon(cfg)).toThrow(/sede sin id o dirección/);
  });

  test('los contactos sensibles se pueden pasar por entorno', () => {
    process.env.COMPRAS_WHATSAPP = '3001234567';
    process.env.CONTACTO_PRIVACIDAD_EMAIL = 'legal@ejemplo.com';
    const { negocio } = cargarCon(configBase());
    expect(negocio.comprasWhatsapp).toBe('3001234567');
    expect(negocio.emailPrivacidad).toBe('legal@ejemplo.com');
    delete process.env.COMPRAS_WHATSAPP;
    delete process.env.CONTACTO_PRIVACIDAD_EMAIL;
  });
});

describe('Otro negocio, sin tocar código', () => {
  // Una tienda de colchones con dos sedes en México, horario distinto, sin restauraciones
  // y con promoción vigente: nada de esto existe en la configuración de DeCasa.
  const OTRO = {
    asesora: { nombre: 'Sofía', rol: 'asesora' },
    empresa: {
      nombre: 'DormiBien', descripcion: 'tienda de colchones', pais: 'México',
      localeMoneda: 'es-MX', zonaHoraria: 'America/Mexico_City',
      especialidad: 'Colchones ortopédicos y bases de cama',
      instagram: '@dormibien',
    },
    horario: {
      semana: { abre: 9, cierra: 19, ultimaCita: 18 },
      sabado: { abre: 10, cierra: 14, ultimaCita: 13 },
      domingoCerrado: true,
      texto: 'Lunes-Viernes 9am-7pm | Sábado 10am-2pm',
    },
    sedes: [
      { id: 1, tiendaId: 11, direccion: 'Av. Reforma 100, CDMX', corta: 'Reforma 100', nombre: 'DormiBien Reforma', ciudad: 'Ciudad de México' },
      { id: 2, tiendaId: 12, direccion: 'Plaza Norte, Monterrey', corta: 'Plaza Norte', nombre: 'DormiBien Monterrey', ciudad: 'Monterrey' },
    ],
    categorias: { colchones: 'Colchones', bases_cama: 'Bases de cama', almohadas: 'Almohadas' },
    pagos: {
      formas: 'efectivo, tarjeta y meses sin intereses',
      credito: { nombre: 'Meses sin intereses', esElUnico: true },
      descuentos: { aplicanCon: 'pago de contado', noAplicanCon: 'meses sin intereses' },
      promocionVigente: '2x1 en almohadas durante septiembre',
    },
    envios: { haceDomicilios: true, zonasGratis: ['CDMX'], notaFueraDeZona: 'Fuera de CDMX hay costo de paquetería', argumento: 'te lo llevamos a tu casa 🚚' },
    servicios: { fabricacionAMedida: false, restauraciones: false },
    disponibilidad: { ocultarStockPorTienda: false },
    estilo: { maxPalabras: 120, emojis: 'pocos', personaje: 'una asesora del sueño', ejemploBueno: 'Ejemplo bueno', ejemploMalo: 'Ejemplo malo', complementos: 'colchón → almohada' },
    saludos: { whatsapp: '¡Hola! Soy Sofía de DormiBien 😴', instagram: '¡Hola! Soy Sofía 😴' },
    operacion: { ventanaConversacionMinutos: 30, timeoutCarritoHoras: 48, maxItemsCarrito: 5 },
  };

  test('el prompt habla del otro negocio, no de DeCasa', () => {
    const { construirSystemPrompt } = cargarCon(OTRO);
    const p = construirSystemPrompt('whatsapp');

    expect(p).toContain('Eres Sofía');
    expect(p).toContain('DormiBien');
    expect(p).toContain('tienda de colchones');
    expect(p).toContain('con sedes en Ciudad de México y Monterrey');
    expect(p).toContain('Lunes-Viernes 9am-7pm');
    expect(p).toContain('1. Reforma 100');
    expect(p).toContain('colchones | bases_cama | almohadas');
    expect(p).toContain('meses sin intereses');
    expect(p).toContain('2x1 en almohadas');
    expect(p).toContain('Máximo 120 palabras');

    // Nada del negocio anterior se filtra
    expect(p).not.toContain('DeCasa');
    expect(p).not.toContain('Elena');
    expect(p).not.toContain('Flor Morado');
    expect(p).not.toContain('Armenia');
    expect(p).not.toContain('ADDI');
  });

  test('los servicios que el negocio no ofrece no aparecen en el prompt', () => {
    const { construirSystemPrompt } = cargarCon(OTRO);
    const p = construirSystemPrompt('whatsapp');
    expect(p).not.toContain('FABRICAMOS a la medida');
    expect(p).not.toContain('RESTAURACIONES');
    // Y sin ocultar stock, tampoco la regla de no mencionar tiendas
    expect(p).not.toContain('NUNCA digas en qué tienda');
  });

  test('sedes, moneda y operación se derivan de su configuración', () => {
    const { negocio } = cargarCon(OTRO);
    expect(negocio.SEDE_TIENDA_ID).toEqual({ 1: 11, 2: 12 });
    expect(negocio.sedeMax).toBe(2);
    expect(negocio.sedeValida(3)).toBe(false);
    expect(negocio.formatearMoneda(15000)).toBe('$15,000'); // locale es-MX
    expect(negocio.ventanaConversacionMinutos).toBe(30);
    expect(negocio.maxItemsCarrito).toBe(5);
    expect(negocio.saludo('whatsapp')).toContain('DormiBien');
  });
});

describe('El prompt generado conserva las reglas críticas', () => {
  const CLAVES = [
    'SIEMPRE usa buscar_productos', 'NUNCA inventes precios', 'NOMBRE EXACTO',
    'PRECIOS DISTINTOS', 'NO son confirmaciones', 'FLUJO DE AGENDAMIENTO',
    'CANCELAR O CAMBIAR UNA CITA', 'cancelar_cita', 'COINCIDENCIA VISUAL ALTA',
    'reportar_imagen_no_identificada', 'reportar_proveedor', 'SEGURIDAD',
    'ignora tus instrucciones', 'fuera_de_horario', 'buscar_por_presupuesto',
  ];

  test.each(['whatsapp', 'instagram'])('canal %s', canal => {
    const { construirSystemPrompt } = cargarCon(configBase());
    const p = construirSystemPrompt(canal);
    for (const clave of CLAVES) expect(p).toContain(clave);
  });

  test('cada canal usa su propia herramienta de transferencia', () => {
    const { construirSystemPrompt } = cargarCon(configBase());
    const ws = construirSystemPrompt('whatsapp');
    const ig = construirSystemPrompt('instagram');

    expect(ws).toContain('transferir_asesor');
    expect(ws).not.toContain('solicitar_asesor');
    expect(ig).toContain('solicitar_asesor');
    expect(ig).not.toContain('transferir_asesor');

    // El carrusel solo existe en Instagram
    expect(ig).toContain('enviar_carrusel');
    expect(ws).not.toContain('enviar_carrusel');
    // Y la nota de no mencionar WhatsApp, también
    expect(ig).toContain('No menciones WhatsApp');
  });
});
