require('dotenv').config();
const mysql = require('mysql2/promise');

async function initDB() {
  let connection;

  try {
    const dbName = process.env.DB_NAME || 'decasa_bot';

    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      port: process.env.DB_PORT || 3306,
      database: dbName
    });

    console.log(`✅ Conectado a base de datos '${dbName}'`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS clientes_wa (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        telefono VARCHAR(20) UNIQUE NOT NULL,
        nombre VARCHAR(100),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_interaction DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    const [colsUsuarios] = await connection.query('SHOW COLUMNS FROM clientes_wa');
    const nombresColsUsuarios = colsUsuarios.map(c => c.Field);
    if (!nombresColsUsuarios.includes('last_interaction')) {
      await connection.query(`ALTER TABLE clientes_wa ADD COLUMN last_interaction DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
      console.log('✅ Columna last_interaction añadida a clientes_wa');
    }
    if (!nombresColsUsuarios.includes('nombre')) {
      await connection.query(`ALTER TABLE clientes_wa ADD COLUMN nombre VARCHAR(100)`);
      console.log('✅ Columna nombre añadida a clientes_wa');
    }
    console.log('✅ Tabla clientes_wa creada o verificada');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS conversaciones (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        usuario_id BIGINT UNSIGNED NOT NULL,
        role ENUM('user', 'assistant') NOT NULL,
        contenido TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES clientes_wa(id) ON DELETE CASCADE,
        INDEX idx_usuario_fecha (usuario_id, created_at)
      )
    `);
    console.log('✅ Tabla conversaciones creada o verificada');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS estado_usuario (
        usuario_id BIGINT UNSIGNED PRIMARY KEY,
        categoria_actual VARCHAR(50),
        producto_pendiente JSON,
        carrito JSON,
        transferido BOOLEAN DEFAULT FALSE,
        greeting_sent BOOLEAN DEFAULT FALSE,
        tiene_pedido BOOLEAN DEFAULT FALSE,
        ultimo_producto JSON,
        agendando_cita BOOLEAN DEFAULT FALSE,
        paso_agenda INT DEFAULT 0,
        datos_agenda JSON,
        transferencia_medida_pendiente JSON,
        candidatos_pendientes JSON,
        FOREIGN KEY (usuario_id) REFERENCES clientes_wa(id) ON DELETE CASCADE
      )
    `);
    
    const [columnas] = await connection.query('SHOW COLUMNS FROM estado_usuario');
    const nombresColumnas = columnas.map(c => c.Field);
    
    if (!nombresColumnas.includes('tiene_pedido')) {
      await connection.query(`
        ALTER TABLE estado_usuario ADD COLUMN tiene_pedido BOOLEAN DEFAULT FALSE
      `);
    }
    
    if (!nombresColumnas.includes('ultimo_producto')) {
      await connection.query(`
        ALTER TABLE estado_usuario ADD COLUMN ultimo_producto JSON
      `);
    }
    console.log('✅ Tabla estado_usuario creada o verificada');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        usuario_id BIGINT UNSIGNED NOT NULL,
        producto VARCHAR(255) NOT NULL,
        precio VARCHAR(50) NOT NULL,
        cantidad INT DEFAULT 1,
        estado ENUM('confirmado', 'entregado', 'cancelado') DEFAULT 'confirmado',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES clientes_wa(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ Tabla pedidos creada o verificada');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS citas_agentes (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        usuario_id BIGINT UNSIGNED NOT NULL,
        telefono VARCHAR(20) NOT NULL,
        nombre VARCHAR(100),
        dia VARCHAR(20),
        hora VARCHAR(20),
        razon TEXT,
        ubicacion INT,
        estado ENUM('pendiente', 'confirmada', 'cancelada') DEFAULT 'pendiente',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES clientes_wa(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ Tabla citas_agentes creada o verificada');

    const [colsEstado] = await connection.query('SHOW COLUMNS FROM estado_usuario');
    const nombresColsEstado = colsEstado.map(c => c.Field);
    if (!nombresColsEstado.includes('agendando_cita')) {
      await connection.query(`
        ALTER TABLE estado_usuario ADD COLUMN agendando_cita BOOLEAN DEFAULT FALSE
      `);
      console.log('✅ Columna agendando_cita añadida');
    }
    if (!nombresColsEstado.includes('paso_agenda')) {
      await connection.query(`
        ALTER TABLE estado_usuario ADD COLUMN paso_agenda INT DEFAULT 0
      `);
      console.log('✅ Columna paso_agenda añadida');
    }
    if (!nombresColsEstado.includes('datos_agenda')) {
      await connection.query(`
        ALTER TABLE estado_usuario ADD COLUMN datos_agenda JSON
      `);
      console.log('✅ Columna datos_agenda añadida');
    }
    if (!nombresColsEstado.includes('transferencia_medida_pendiente')) {
      await connection.query(`
        ALTER TABLE estado_usuario ADD COLUMN transferencia_medida_pendiente JSON
      `);
      console.log('✅ Columna transferencia_medida_pendiente añadida');
    }
    if (!nombresColsEstado.includes('candidatos_pendientes')) {
      await connection.query(`
        ALTER TABLE estado_usuario ADD COLUMN candidatos_pendientes JSON
      `);
      console.log('✅ Columna candidatos_pendientes añadida');
    }
    if (!nombresColsEstado.includes('subtipo_pendiente')) {
      await connection.query(`
        ALTER TABLE estado_usuario ADD COLUMN subtipo_pendiente JSON
      `);
      console.log('✅ Columna subtipo_pendiente añadida');
    }
    if (!nombresColsEstado.includes('comparacion_pendiente')) {
      await connection.query(`
        ALTER TABLE estado_usuario ADD COLUMN comparacion_pendiente JSON
      `);
      console.log('✅ Columna comparacion_pendiente añadida');
    }
    if (!nombresColsEstado.includes('comparacion_productos')) {
      await connection.query(`
        ALTER TABLE estado_usuario ADD COLUMN comparacion_productos JSON
      `);
      console.log('✅ Columna comparacion_productos añadida');
    }
    if (!nombresColsEstado.includes('presupuesto')) {
      await connection.query(`
        ALTER TABLE estado_usuario ADD COLUMN presupuesto VARCHAR(100)
      `);
      console.log('✅ Columna presupuesto añadida');
    }

    // Cache de perceptual hash (dHash) de las fotos de productos, para poder
    // identificar por comparación de imagen cuando un cliente reenvía/captura una
    // foto que ya está en nuestro propio catálogo. No pertenece a Laravel: es solo
    // un índice derivado que este agente reconstruye por su cuenta.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS producto_imagen_hash (
        producto_nombre VARCHAR(150) PRIMARY KEY,
        imagen_url      VARCHAR(500) NOT NULL,
        hash            CHAR(16) NOT NULL,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla producto_imagen_hash creada o verificada');

    console.log('\n🎉 Base de datos lista!\n');
    
  } catch (error) {
    console.error('❌ Error inicializando BD:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

if (require.main === module) {
  initDB();
}

module.exports = { initDB };