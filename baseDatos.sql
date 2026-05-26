-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: mysql-314c74b4-juandavidrestrepobetancur756-c1fe.d.aivencloud.com    Database: defaultdb
-- ------------------------------------------------------
-- Server version	8.0.45

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '95e4d4de-3cc5-11f1-85d1-ee10f6ee547d:1-541,
a01756ef-3d92-11f1-b8e4-f68cc5415069:1-1318';

--
-- Table structure for table `estado_usuario`
--

DROP TABLE IF EXISTS `estado_usuario`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `estado_usuario` (
  `usuario_id` int NOT NULL,
  `categoria_actual` varchar(50) DEFAULT NULL,
  `producto_pendiente` json DEFAULT NULL,
  `carrito` json DEFAULT NULL,
  `transferido` tinyint(1) DEFAULT '0',
  `greeting_sent` tinyint(1) DEFAULT '0',
  `ultimo_producto` json DEFAULT NULL,
  `tiene_pedido` tinyint(1) DEFAULT '0',
  `agendando_cita` tinyint(1) DEFAULT '0',
  `paso_agenda` int DEFAULT '0',
  `datos_agenda` json DEFAULT NULL,
  `presupuesto` decimal(10,2) DEFAULT NULL,
  `transferencia_medida_pendiente` json DEFAULT NULL,
  PRIMARY KEY (`usuario_id`),
  CONSTRAINT `estado_usuario_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `estado_usuario`
--

LOCK TABLES `estado_usuario` WRITE;
/*!40000 ALTER TABLE `estado_usuario` DISABLE KEYS */;
INSERT INTO `estado_usuario` VALUES (1,'sofas','{\"precio\": \"$3.040.000\", \"cantidad\": null, \"producto\": \"SOFA TELAVID\"}','[]',0,1,NULL,0,0,0,NULL,NULL,NULL);
/*!40000 ALTER TABLE `estado_usuario` ENABLE KEYS */;
UNLOCK TABLES;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-29 10:18:39

-------------------------------------

-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: mysql-314c74b4-juandavidrestrepobetancur756-c1fe.d.aivencloud.com    Database: defaultdb
-- ------------------------------------------------------
-- Server version	8.0.45

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '95e4d4de-3cc5-11f1-85d1-ee10f6ee547d:1-541,
a01756ef-3d92-11f1-b8e4-f68cc5415069:1-1318';

--
-- Table structure for table `conversaciones`
--

DROP TABLE IF EXISTS `conversaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `conversaciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `role` enum('user','assistant') NOT NULL,
  `contenido` text NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_usuario_fecha` (`usuario_id`,`created_at`),
  CONSTRAINT `conversaciones_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `conversaciones`
--

LOCK TABLES `conversaciones` WRITE;
/*!40000 ALTER TABLE `conversaciones` DISABLE KEYS */;
INSERT INTO `conversaciones` VALUES (28,1,'user','Ola','2026-04-29 14:35:53'),(29,1,'assistant','Hola! ? Soy Elena, tu asesora de DeCasa.\n\n? Especialistas en muebles de madera Flor Morado (más de 200 productos)\n? Nuestras tiendas en Armenia, Quindío:\n   - Av. Bolívar # 16 N 26\n   - Km 2 vía El Edén\n   - Km 1 vía Jardines\n\n? Categorías: Sillas, Bases, Camas, Mesas, Sofás\n? Horario: L-V 8am-5pm\n\n? Estoy para ayudarte con información o comprar muebles. \n   ¿Qué necesitas? ?','2026-04-29 14:35:53'),(30,1,'assistant','Claro! Estas son las categorías disponibles:\ncajoneros y bifes, camas, mesas auxiliares, mesas de centro, mesas de noche, mesas de televisor, bases de comedores, sillas auxiliares, sillas de barra, sofas, sofacamas, sofas modulares\n\n¿ cual te gustaría ver? ?','2026-04-29 14:36:11'),(31,1,'assistant','Claro! Aquí tienes el catálogo de sofas ?','2026-04-29 14:36:27'),(32,1,'assistant','Disculpa, solo puedo ayudarte con información sobre nuestros muebles de DeCasa ? \n\n¿Te puedo mostrar nuestro catálogo de productos? ?\n\n? Síguenos en Instagram: @muebles_decasa\n? ¡Mantente al día con nuestros productos y ofertas!\n\nQue tengas un lindo día! ?','2026-04-29 14:36:50'),(33,1,'user','Me gusta el sofá Orión','2026-04-29 14:37:03'),(34,1,'assistant','Disculpa, no encontré \'sofá Orión\' en nuestro inventario. ¿Podrías verificar el nombre o decirme qué tipo de mueble buscas? ¿Te puedo mostrar nuestro catálogo?','2026-04-29 14:37:14'),(35,1,'assistant','SOFA TELAVID\n? Precio: $3.040.000\n? Medidas: 2.00 x 0.90\n? Material: Tapizado\n\n¿Confirmas agregar al carrito? Responde \"sí\" para confirmar ?','2026-04-29 14:38:11'),(36,1,'assistant','Disculpa, solo puedo ayudarte con información sobre nuestros muebles de DeCasa ? \n\n¿Te puedo mostrar nuestro catálogo de productos? ?\n\n? Síguenos en Instagram: @muebles_decasa\n? ¡Mantente al día con nuestros productos y ofertas!\n\nQue tengas un lindo día! ?','2026-04-29 14:38:23');
/*!40000 ALTER TABLE `conversaciones` ENABLE KEYS */;
UNLOCK TABLES;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-29 10:18:17

--------------------------------------

-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: mysql-314c74b4-juandavidrestrepobetancur756-c1fe.d.aivencloud.com    Database: defaultdb
-- ------------------------------------------------------
-- Server version	8.0.45

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '95e4d4de-3cc5-11f1-85d1-ee10f6ee547d:1-541,
a01756ef-3d92-11f1-b8e4-f68cc5415069:1-1318';

--
-- Table structure for table `pedidos`
--

DROP TABLE IF EXISTS `pedidos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pedidos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `producto` varchar(255) NOT NULL,
  `precio` varchar(50) NOT NULL,
  `cantidad` int DEFAULT '1',
  `estado` enum('confirmado','entregado','cancelado') DEFAULT 'confirmado',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `usuario_id` (`usuario_id`),
  CONSTRAINT `pedidos_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pedidos`
--

LOCK TABLES `pedidos` WRITE;
/*!40000 ALTER TABLE `pedidos` DISABLE KEYS */;
/*!40000 ALTER TABLE `pedidos` ENABLE KEYS */;
UNLOCK TABLES;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-29 10:18:34

---------------------------------------

-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: mysql-314c74b4-juandavidrestrepobetancur756-c1fe.d.aivencloud.com    Database: defaultdb
-- ------------------------------------------------------
-- Server version	8.0.45

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '95e4d4de-3cc5-11f1-85d1-ee10f6ee547d:1-541,
a01756ef-3d92-11f1-b8e4-f68cc5415069:1-1318';

--
-- Table structure for table `productos`
--

DROP TABLE IF EXISTS `productos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `productos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `precio` decimal(12,2) NOT NULL DEFAULT '0.00',
  `imagen` text COLLATE utf8mb4_unicode_ci,
  `descripcion` text COLLATE utf8mb4_unicode_ci,
  `medidas` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `material` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `categoria_id` int NOT NULL,
  `subcategoria` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_categoria` (`categoria_id`),
  KEY `idx_subcategoria` (`subcategoria`),
  CONSTRAINT `fk_categoria` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=181 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `productos`
--

LOCK TABLES `productos` WRITE;
/*!40000 ALTER TABLE `productos` DISABLE KEYS */;
INSERT INTO `productos` VALUES (1,'CAMA DINTEL',3680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776885739/CAMA_DINTEL_xxcgsr.jpg','Elegancia y sofisticación se unen en esta Cama Dintel. Su diseño exclusivo de cabecera tipo arco aporta un toque arquitectónico único a tu dormitorio. Fabricada en finos madera de Flor Morado, una especie nativa colombiana reconocida por su durabilidad excepcional y vetas naturales que la convierten en una pieza de arte. El acabado perfecto combina tradición artesanal con diseño contemporáneo para crear el ambiente de descanso que mereces.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Madera Flor Morado',1,'camas'),(2,'CAMA LINEAL',2880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776885735/CAMA_LINEAL_qmt8po.jpg','La Cama Lineal representa la esencia del minimalismo elegante. Su diseño de líneas limpias y tapizado impecable se integra perfectamente en cualquier espacio moderno. Los apliques horizontales o verticales permiten personalización según tu estilo, creando una pieza única que refleja tu personalidad. El tejido de alta calidad asegura comodidad duradera mientras su estructura robusta garantiza años de descanso tranquilo.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Tapizada - Apliques Horizontal/Vertical (según solicitud del cliente)',1,'camas'),(3,'CAMA BALI',2880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776890931/CAMA_BALI.jpg_us5rhr.jpg','Inspírate en los sabores tropicales con la Cama Bali, una pieza que trae la serenidad de las islas a tu hogar. Su diseño exclusivo de cabecera con courved orgánicas crea un ambiente relajante y acogedor, perfecto para escapar del estrés diario. El tapizado premium ofrece la combinación ideal de comfort y estilo, transformando tu habitación en un santuario de paz.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Tapizada',1,'camas'),(4,'CAMA FIGY (Con Alerones)',5780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776885741/CAMA_FIGY_CON_ALERONES_uriiot.jpg','La Cama Figy con Alerones es la pieza central definitiva para tu dormitorio master. Su diseño spectacular de cabecera con alerones flanking crea un impacto visual dramático que establece el tono de todo el espacio. Fabricada en prestigiosa madera Flor Morado, cada pieza exhibe vetas únicas que la hacen irrepetible. Los alerones proporciona soporte adicional para leer o ver televisión,融合ando funcionalidad con diseño de autor.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Madera Flor Morado',1,'camas'),(5,'CAMA APLIQUES CENTRAL',2680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776884282/CAMA_APLIQUES_CENTRAL_btou2m.jpg','Distínguete con la Cama Apliques Central, donde el diseño encuentra la artesanía. Los appliques centrada en la cabecera crean un focal point elegante que captura la atención inmediatamente. En constructores con prestigiosa madera Flor Morado, esta cama combina la calidez natural de la madera con detalles decorativos sofisticados, resultando en una pieza que trasciende lo ordinario.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Madera Flor Morado',1,'camas'),(6,'CAMA CHOCOLATINA',1580000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776884797/CAMA_CHOCOLATINA_zhgeta.jpg','La Cama Chocolatina bringe calidez y accesibilidad a tu espacio de descanso. Su diseño clásico de cabecera con acabado en Triple Cedro Pintado ofrece durabilidad comprobada a un precio excepcional. Esta opción perfecta para quienes buscan calidad sin comprometer el presupuesto, sin sacrificar estilo. El acabado paint de primera garantizan una apariencia impecable por años.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Triple Cedro Pintada',1,'camas'),(7,'CAMA MACANA',3780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776885732/CAMA_MACANA_ewjlro.jpg','La Cama Macana es una declaración de buen gusto. Su diseño robusto de cabecera en madera Flor Morado exhibe la belleza natural de esta especie premium, con vetas que crean patrones visuales únicos en cada pieza. La construcción sólida asegura estabilidad duradera mientras el diseño atemporal se adapta a múltiples estilos decorativos, desde clásico hasta contemporáneo.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Madera Flor Morado',1,'camas'),(8,'CAMA ESTOCOLMO',3780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776885732/CAMA_ESTOCOLMO_gkxg9b.jpg','Descubre el diseño escandinavo con la Cama Estocolmo. Este modelo trae la esencia del mobiliario nórdico a tu dormitorio, combinando simplicidad funcional con materiales naturales. La cabecera de diseño limpio en pino de calidad ofrece líneas depuradas que maximizan la sensación de espacio, perfecta para квартиры modernas.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Pino',1,'camas'),(9,'CAMA SAVANNA',3380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776886134/CAMA_SAVANNA_udkmbt.jpg','La Cama Savanna transforma tu dormitorio en un refugio de elegancia colonial. Su tapizado lineal vertical crea textura y profundidad que captura la luz de manera espectaculary única. El diseño inspirado en classic mobilier estadounidense combina comfort contemporáneo con atemporalidad stylística, resultando en una pieza que mejora con el tiempo.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Tapizada Lineal Vertical',1,'camas'),(10,'CAMA DIAMANTE',3680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776884795/CAMA_DIAMANTE_n66kka.jpg','Brilla con la Cama Diamante, una pieza que captura la luz y la reflexión en cada ángulo. Su diseño geométrico de facets crea movement visual dinámico que añade vida a tu espacio. La combinación de lamina de Flor Morado natural con el corte diamante produce un efecto tridimensional único, haciendo de cada noche una experiencia visual tão atractiva como el comfort físico.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Flor Morado Natural Lamina',1,'camas'),(11,'CAMA BARCELONETA',2880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776884797/CAMA_BARCELONETA_ggvb6e.jpg','Lleva el encanto Mediterráneo a tu hogar con la Cama Barceloneta. Su diseño relajado y sofisticado evoca las costas españolas, creando una atmósfera vacacional permanente en tu dormitorio. La cabecera de laminado en Flor Morado natural combina calidez con durabilidad, mientras las líneas suaves invitan al descanso. Es la opción perfecta para quienes buscan un escape sin salir de casa.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Flor Morado Natural Lamina',1,'camas'),(12,'CAMA VIENNA',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776886132/CAMA_VIENNA_hcs8ez.jpg','Experimenta la tradición Viennera con un giro contemporáneo. La Cama Vienna presenta su tapizado de diseño a cuadros que aporta carácter y personalidad a tu espacio. Este patrón clásico actualizado crea un ambiente acogedor sin sacrificar modernidad, haciendo juego perfecto con múltiples paletas de color y estilos decorativos.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Tapizada Cuadros',1,'camas'),(13,'CAMA OSLO',2680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776885728/CAMA_OSLO_ah0ksd.jpg','La Cama Oslo trae la esencia del diseño nórdico a tu espacio. Su cabecera de laminado en Flor Morado natural presenta líneas minimalistas que maximizan la sensación de espacio y luz. Esta pieza funcional y hermosa representa la filosofía escandinava de que menos es más, creando un environnement tranquilo ideal para el descanso.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Flor Morado Natural Lamina',1,'camas'),(14,'CAMA ÉBANO',2880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776885737/CAMA_EBANO_pnjwbd.jpg','La Cama Ébano es elegancia dark en su forma más pura. El intenso color de la madera Flor Morado crea un statement audaz que domina el espacio con sofisticación. Esta pieza atemporal irradia lujo contenido, perfecta para crear un dormitorio con carácter fuerte y personalidad definidos. La madera de primera calidad asegura belleza duradera.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Madera Flor Morado',1,'camas'),(15,'CAMA BETHEL',3380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776884792/CAMA_BETHEL_uxzsbw.jpg','La Cama Bethel combina comodidad con estilo en perfectaHarmonía. Su cabecera tapizada oferece un respaldo perfecto para leer o ver television, mientras el diseño líneas aporta presencia visual sin abrumar el espacio. El tapizado de calidad premium garantiza comfort duradero y facilidad de mantenimiento, convirtiendo tu cama en el centro de tu régimen de autocuidado.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Tapizada',1,'camas'),(16,'CAMA EDEN',3380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776885736/CAMA_EDEN_tps6fb.jpg','Tu dormitorio merece ser un edén moderno. La Cama Eden ofrece el sanctuary perfecto con su diseño tapizado que combina softness con soporte. La поверхность suavemente texturizada Invita al descanso, mientras las líneasclean permiten múltiples posibilidades de styling. Es el refugio definitivo para recuperar energía después de días largos.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Tapizada',1,'camas'),(17,'CAMA SIENNA',3380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776886131/CMA_SIENNA_cxy6gr.jpg','La Cama Sienna trae calidez terrenal a tu space. Su diseño tapizado de perfil bajo crea un profile sleek que hace tu habitación parecer más espaciosa, mientras ofrece comfort excepcional. Esta pieza versátil trabaja igual de bien en minimalist spaces como en maximalist enviros, adaptándose a tu estilo de vida.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Tapizada',1,'camas'),(18,'CAMA SIENNA DIVIDIDA (Cama Baul)',3380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776886135/CAMA_SIENNA_DIVIDIDA_nt8lhu.jpg','Maximiza tu espacio con la Cama Sienna Dividida, el diseño innovador que combina descanso con almacenaje. Esta cama baul ofrece storage generoso sin sacrificar estilo, manteniendo el look elegante de la Sienna original mientras addiciona funcionalidad práctica. Perfect para viviendas donde cada metro cuadrado cuenta.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Tapizada',1,'camas'),(19,'CAMA VERTICE',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776886133/CAMA_VERTICE_fslu9n.jpg','数学 Meets Design con la Cama Vértice. Su diseño de cabecerageometric crea un punto focal dinámico que captura atenção desde cualquier ángulo. La precisión del corte en madera Flor Morado demuestra elskill artesanal, mientras el resultado final aporta un toque de arquitectura a tu dormitorio. Ideal para quienes aprecian la innovación.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Madera Flor Morado',1,'camas'),(20,'CAMA MIAMI',2680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776885732/CAMA_MIAMI_ktnbrd.jpg','Vive el lifestyle playero con la Cama Miami. Su combinación de madera Flor Morado con chapilla crea un look sofisticado que evoca la elegancia costera. El diseño clean pero con carácter aporta freshness a tu dormitorio, haciendo cada día sienta como unas mini vacaciones. Es la opción perfecta para квартиры con espíritu relajado.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Madera Flor Morado y Chapilla',1,'camas'),(21,'CAMA ALISTONADA',2880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776884287/CAMA_ALISTONADA_desue2.jpg','Añade текстура y dimensión con la Cama Alistonada. Su diseño de listones proporciona interés visual que captura la luz de manera única, creando sombras y reflejos que dynamizan el espacio. La qualidade de la madera Flor Morado asegura que esta pieza sea un heirloom que puedes passar de generación en generación.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Madera Flor Morado',1,'camas'),(22,'CAMA MACARENA',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776885736/CAMA_MACARENA_pc2zuy.jpg','La Cama Macarena es tradición con corazón. Su diseño de cabecera con postesy cabeceros bercerita la historia del mobiliario clásico mientras mantiene funcionalidad moderna. La madera Flor Morado de primera calidad añade calidez natural al espacio, creando un ambiente acogedor que welcome you home después de un largo día.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Madera Flor Morado',1,'camas'),(23,'CAMA FLOR MORADO LISA',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776878013/flor_morado_lisa.jpg_1_ttf9cq.jpg','La simplicidadexquisita encuentra en la Cama Flor Morado Lisa. Su diseño minimalista deja que la beautifulz natural de la madera seja la estrella del show. Las vetas únicas de cada pieza crean arte orgánico que no puede ser reproducido, haciendo tu cama verdaderamente única. Es la elección perfecta para quienes aprecian la belleza natural.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Madera Flor Morado',1,'camas'),(24,'BASE CAMA',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776884306/BASE_CAMA_bhhyrn.jpg','La Base Cama es funcionalidad puro en su forma más elegante. Su diseño tapizado ofreceun foundation sólida para tu colchón mientras mantiene un look sofisticado. Esta base también puede funcionar como solución de storage, proporcionando espacio adicional para sábanas, mantas u otrositems sin sacrificar estética. Calidad que ves y sientes.','Puede ajustarse/fabricarse según gusto y necesidad del cliente','Tapizada',1,'camas'),(25,'MESA NOCHE BELMONTE',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887119/MESA_BELMONTE_emvbhx.jpg','La Mesa Noche Belmonte aporta distinción a tu espacio de descanso. Su diseño elegante en Flor Morado natural crea el complemento perfecto para cualquier cama, añadiendo funcionalidad sin sacrificar estilo. El tamaño optimizado cabe perfectamente junto a cualquier cama mientras ofrece storage suficiente para tus essentials nocturnos.','0.50 x 0.40 aprox','Flor Morado Natural',1,'mesas_noche'),(26,'MESA NOCHE MIAMI UN CAJON',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887036/MESA_MIAMI_jdfmkx.jpg','Funcionalidad meetstyle en la Mesa Noche Miami. Su cajón único proporciona storage organizado para objetos personales, mientras su diseño sleek en Flor Morado natural añade calidez al dormitorio. El tamaño compacto es perfecto para espacios reducidos sin comprometer accesibilidad. Tu mesita de noche ideal espera.','0.50 x 0.40 aprox','Flor Morado Natural',1,'mesas_noche'),(27,'MESA NOCHE TV DUPLEX',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887023/MESA_TV_DUPLEX_flwwmy.jpg','La Mesa Noche TV Duplex trae innovación a tu bedroom. Su diseño de dos niveles ofrece múltiples posibilidades: un nivel para tu lamparita, otro para el control remoto y otros essentials. La combinación de Cedro con Flor Morado natural añade variación textural mientras mantiene sofisticación.','0.50 x 0.40 aprox','Cedro, Flor Morado Natural',1,'mesas_noche'),(28,'MESA NOCHE PIRAMIDE',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887033/MESA_PIRAMIDE_nskqf5.jpg','Geometría meets functionality con la Mesa Noche Pirámide. Su diseño pyramidal único llama la atención mientras ofrece storage prático. El acabado en Flor Morado natural deja apreciar la belleza de la madera, convirtiendo un mueble utilitario en arte funcional para tu habitación.','0.50 x 0.40 aprox','Flor Morado Natural',1,'mesas_noche'),(29,'MESA NOCHE MARGARITA',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887038/MESA_MARGARITA_kvarad.jpg','La Mesa Noche Margarita trae delicadeza floral a tu dormitorio. Su diseño exclusivo parece una flor aberta, creando un punto focal encantador. Disponible en versión pintada o natural, puedes elegir quella que mejor complemente tu decoración. Es la mesita perfecta para quienes aprecian detalles únicos.','0.50 x 0.40 aprox','Flor Morado Natural (Pintado: $780.000 / Flor Morado: $880.000)',1,'mesas_noche'),(30,'MESA NOCHE DIAMANTE',880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887038/MESA_DIAMANTE_dmz4ml.jpg','Brilla con la Mesa Noche Diamante. Su diseño geométrico unique captura luz de maneras herramient creating sombras fascinantes. El Flor Morado natural asegura durabilidad excepcional mientras el diseño diamond crea movimiento visual que animates tu espacio.','0.50 x 0.40 aprox','Flor Morado Natural',1,'mesas_noche'),(31,'MESA NOCHE MACANA',880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887035/MESA_MACANA_y0ri5c.jpg',' strength and style se unen en la Mesa Noche Macana. Su diseño robusto de líneas definidas aporta presencia sin abrumar el espacio. El Flor Morado natural de primera calidad garantiza que esta pieza durará generaciones, convirtiéndose en heredanza familiar.','0.50 x 0.40 aprox','Flor Morado Natural',1,'mesas_noche'),(32,'MESA NOCHE SANTA MARTA',880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887034/MESA_SANTA_MARTA_qnidpr.jpg','Vive el encanto caribe con la Mesa Noche Santa Marta. Su diseño exclusivo en lamina Flor Morado aporta carácter playero a tu espacio. Esta pieza crea el equilibrio perfecto entre funcionalidad y estilo costeño, haciendo tu nórdico suite feel como unas vacaciones permanentes.','0.50 x 0.40 aprox','Lamina Flor Morado',1,'mesas_noche'),(33,'MESA NOCHE TV UN CAJON',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887032/MESA_TV_1_CAJON_b34wql.jpg','La Mesa Noche TV Un Cajón es el companion perfecto para lazy Sundays. Su cajón espacioso guarda todo lo que necesitas a la mano mientras su diseño clean no compite con tu television o decoración. El Flor Morado natural añade calidez, haciendo de tu rincón de entretenimiento algo aún más demócr.','0.50 x 0.40 aprox','Flor Morado Natural',1,'mesas_noche'),(34,'MESA NOCHE DELTA',880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887120/MESA_DELTA_men0dx.jpg','La letra Delta gets un makeover con la Mesa Noche Delta. Su diseño de forma triangular unique crea interest visual dinámico. Esta pieza es el conversation starter perfecto que además proporciona storage práctico para tus esenciales nocturnos. Innovación que ves y usas quotidianamente.','0.50 x 0.40 aprox','Flor Morado Natural',1,'mesas_noche'),(35,'MESA DE NOCHE AMIGABLE',880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887120/MESA_AMIGABLE_nxh0wb.jpg','La Mesa Amigable realmente live up to su nombre. Su diseño accesible y functional hace que reach para tu glass de agua o libro sea natural. El storage organizado mantiene todo a mano sin clutter, mientras su presencia amable aporta calidez a tu sanctuary nocturno.','0.50 x 0.40 aprox','Flor Morado Natural',1,'mesas_noche'),(36,'MESA NOCHE BARCELONETA',880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887117/MESA_BARCELONETA_gappzh.jpg','El Mediterranean vibe llega a tu bedside con la Barceloneta. Este diseño brings the relaxed elegance de las costas españolas a tu hogar. Su appeal atemporal funciona perfectamente con múltiples estilos decorativos, desde clásico hasta contemporáneo.','0.50 x 0.40 aprox','Flor Morado Natural',1,'mesas_noche'),(37,'MESA NOCHE DEKO',880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887117/MESA_DEKO_c03uta.jpg','Diseño que declara: Deko. Esta mesa noche combina funcionalidad con statement de estilo. Su Silhouette distintivo aporta personalidad a tu espacio mientras mantiene toda la utility que necesitas. Es la pieza que tu bedroom ha estado esperando.','0.50 x 0.40 aprox','Flor Morado Natural',1,'mesas_noche'),(38,'MESA DE NOCHE ESTOCOLMO',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887038/MESA_ESTOCOLMO_zb7dqf.jpg','La excelencia nórdica se manifiesta en la Mesa Noche Estocolmo. Su diseño escandinavo clean y funcional exemplifica el philosophy de que menos es más. El Flor Morado natural mantiene calidez mientras el diseño minimalista maximiza la sensación de espacio. Funcionalidad en su expresión más pura.','0.50 x 0.40 aprox','Flor Morado Natural',1,'mesas_noche'),(39,'COLCHON SOPHIA',760000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887518/COLCHON_SOPHIA_ixhjbr.jpg','El.Colchón Sophia representa la combinación perfecta de comfort y accesibilidad. Su construcción standard ofrece el soporte equilibrado que necesitas para noches de sueño reparador. La densidad apropiada se adapta a tu cuerpo, proporcionando el soporte spinal correcto mientras mantiene confort suave. Es el choice ideal para quienes buscan calidad sin complicación.','1.00 x 1.80 / 1.00 x 1.90 / 1.20 x 1.90 / 1.40 x 1.90','Standard',1,'colchones'),(40,'COLCHON MONTECARLO',1490000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887519/COLCHON_MONTECARLO_xyxrtn.jpg','Vive la vida de lujo con el Colchón Montecarlo. Su construcción superior ofrece una experiencia de sueño elevated que transformará cómo wake up cada mañana. El soporte avanzado y la sensación premium hacen cada noche sentirse como una estancia en un resort cinco estrellas. Invierte en tu descanso y siente la diferencia.','1.40 x 1.90 / 1.60 x 1.90 / 2.00 x 2.00','Standard',1,'colchones'),(41,'COLCHON ATENAS',2120000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776887521/COLCHON_ATENAS_hczp2l.jpg','El.colchón Atenas es la cima de la excelencia en descanso. Su construcción premium класса mondiale ofrece el máximo nivel de soporte y comfort disponible. Cada capa está diseñada para proporcionar la experiencia de sueño más refinada posible, para quienes mereces nothing but the best. Despierta verdaderamente descansado cada día.','1.40 x 1.90 / 1.60 x 1.90 / 2.00 x 2.00','Standard',1,'colchones'),(42,'SOFA NUBE',3480000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920923/SOFA_NUBE_cspuig.jpg','Sofá Nube con diseño moderno y cómodo','1.80 x 0.90','Tapizado',2,'sofas'),(43,'SOFA MARBELLA',3040000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776442014/sofa_marbella_q7yulr.jpg','Sofá Marbella diseño elegante','2.00 x 0.90','Tapizado',2,'sofas'),(44,'SOFA TELAVID',3040000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920933/SOFA_TELAVID_e5i9ql.jpg','Sofá TelaVid moderno','2.00 x 0.90','Tapizado',2,'sofas'),(45,'SOFA TERRA',3480000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920935/SOFA_TERRA_z4xnpk.jpg','Sofá Terra diseño contemporáneo','2.40 x 0.90','Tapizado',2,'sofas'),(46,'SOFA AUSTRIA',2840000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920922/SOFA_AUSTRIA_mnqs8w.jpg','Sofá Austria estilo clásico','2.00 x 0.90','Tapizado',2,'sofas'),(47,'SOFA SINGAPUR',2880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920932/SOFA_SINGAPUR_bprpaa.jpg','Sofá Singapur moderno','1.90 x 0.90','Tapizado',2,'sofas'),(48,'SOFA ROMEO',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920928/SOFA_ROMEO_dwzxtz.jpg','Sofá Romeo diseño elegante','1.90 x 0.90','Tapizado',2,'sofas'),(49,'SOFA TORELLO',2040000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920937/SOFA_TORELLO_v3qsds.jpg','Sofá Torello compacto','1.90 x 0.90','Tapizado',2,'sofas'),(50,'SOFA CONFORT',3040000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920957/SOFA_CONFORT_zctnlg.jpg','Sofá Confort máximo comodidad','1.90 x 0.90','Tapizado',2,'sofas'),(51,'SOFA BARILOCHE',2040000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920953/SOFA_BARILOCHE_ft57dd.jpg','Sofá Bariloche estilo sureño','1.60 x 0.90','Tapizado',2,'sofas'),(52,'SOFA SALAMANCA',2780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920930/SOFA_SALAMANCA_zidkkl.jpg','Sofá Salamanca diseño exclusivo','1.90 x 0.90','Tapizado',2,'sofas'),(53,'SOFA PRADA',2040000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920926/SOFA_PRADA_vfx5og.jpg','Sofá Prada clásico','1.60 x 0.90','Tapizado',2,'sofas'),(54,'SOFA CHESTER',3380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920955/SOFA_CHESTER_ljbp8q.jpg','Sofá Chester estilo inglés','2.20 x 0.90','Tapizado',2,'sofas'),(55,'MODULAR CONFORT',5100000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920959/MODULAR_CONFORT_svkynq.jpg','Sofá modular Confort máximo','3.10 x 2.40','Tapizado',2,'sofas'),(56,'MODULAR EVOLUTION',4100000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920948/MODULAR_EVOLUTION_io8qys.jpg','Sofá modular Evolution','2.20 x 0.90','Tapizado',2,'sofas'),(57,'MODULAR ENZO',3780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920946/MODULAR_ENZO_rx040i.jpg','Sofá modular Enzo','2.00 x 0.90','Tapizado',2,'sofas'),(58,'MODULAR ANGEL',3680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920942/MODULAR_ANGEL_z7ack9.jpg','Sofá modular Angel','2.20 x 0.90','Tapizado',2,'sofas'),(59,'MODULAR TERRA',3880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920950/MODULAR_TERRA_gvxcqc.jpg','Sofá modular Terra','2.35 Brazo a Brazo','Tapizado',2,'sofas'),(60,'MODULAR TORONTO',4100000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920951/MODULAR_TORONTO_hwedbs.jpg','Sofá modular Toronto','2.50 x 2.50','Tapizado',2,'sofas'),(61,'MODULAR TELAVID',4100000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920961/MODULAR_TELAVID_n5e22c.jpg','Sofá modular TelaVid','2.30 x 1.60','Tapizado',2,'sofas'),(62,'MODULAR BARILOCHE',2900000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920944/MODULAR_BARILOCHE_swrhlk.jpg','Sofá modular Bariloche','2.10 x 1.40','Tapizado',2,'sofas'),(63,'ESCRITORIO FLOR MORADO',1580000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776889594/ESCRITORIO_FLOR_MORADO_1_bi9lvc.jpg','Escritorio en madera Flor Morado natural. Diseño elegante y funcional para tu espacio de trabajo.','1.20 x 0.50','Madera Flor Morado',4,'escritorios'),(64,'ESCRITORIO OREGON',1180000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776889446/ESCRITORIO_OREGON_q1hhov.jpg','Escritorio estilo Oregon con combinación de pino y Flor Morado. Perfecto para espacios modernos.','1.20 x 0.50','Pino / Flor Morado',4,'escritorios'),(65,'ESCRITORIO NATURAL',1480000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776889448/ESCRITORIO_NATURAL_lc40ku.jpg','Escritorio en pino natural con acabado impeccable. Lineas limpias y diseño minimalista.','1.20 x 0.50','Pino',4,'escritorios'),(66,'NATURAL BASIC',1480000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776889450/ESCRITORIO_NATURAL_BASIC_yabcxd.jpg','Escritorio basic en pino y Flor Morado. Funcionalidad y estilo a un precio accesible.','1.20 x 0.50','Pino / Flor Morado',4,'escritorios'),(67,'ESCRITORIO NORDICO',1380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776889460/ESCRITORIO_NORDICO_gexya2.jpg','Escritorio estilo nórdico en Cedro Rosado. Diseño escandinavo que maximiza el espacio.','1.20 x 0.50','Cedro Rosado',4,'escritorios'),(68,'ESCRITORIO ALISTONADO',1580000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776889452/ESCRITORIO_ALISTONADO_oolgvy.jpg','Escritorio alistonado en Flor Morado. Diseño con listones que aporta textura y carácter.','1.20 x 0.50','Madera Flor Morado',4,'escritorios'),(69,'MESA AUXILIAR OSTEL',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776888797/MESA_OSTEL_arwv8d.jpg','Mesa auxiliar Ostel en Flor Morado natural. Diseño versátil para cualquier espacio.','Standard','Flor Morado Natural',4,'mesas_aux'),(70,'MESA AUX CILINDRO',580000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776888801/MESA_CILINDRO_jur2vg.jpg','Mesa auxiliar forma cilindro con base metropolitana y cubierta en Flor Morado.','Standard','Base Metálica, Cubierta Flor Morado',4,'mesas_aux'),(71,'MESA AUX CUBO',680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776888805/MESA_CUBO_zyuxnl.jpg','Mesa auxiliar forma cubo con base metropolitana y cubierta en Flor Morado.','Standard','Base Metálica, Cubierta Flor Morado',4,'mesas_aux'),(72,'MESA AUX TT',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776888793/MESA_TT_hrivd1.jpg','Mesa auxiliar modelo TT en Flor Morado natural. Diseño único y funcional.','Standard','Flor Morado Natural',4,'mesas_aux'),(73,'MESA AUX REJILLA REDONDA',880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776888805/MESA_REJILLA_REDONDA_zmt64f.jpg','Mesa auxiliar rejilla forma redonda en Flor Morado natural. Diseño elegante y ventilado.','Standard','Flor Morado Natural',4,'mesas_aux'),(74,'CAJONERO SAN DIEGO',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776890476/CAJONERO_SAN_DIEGO_ycwmkl.jpg','Cajonero San Diego en lámina Flor Morado natural. Storage ample para tu espacio.','1.20 x 0.40','Lámina Flor Morado Natural',4,'cajoneros'),(75,'CAJONERO ANGEL',2880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776890505/CAJONERO_ANGEL_ywkbxr.jpg','Cajonero Angel en madera Flor Morado. Diseño sofisticado con líneas elegantes.','1.20 x 0.40','Madera Flor Morado',4,'cajoneros'),(76,'CAJONERO 6 CAJONES',2880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776890494/CAJONERO_6_CAJONES_kebbpx.jpg','Cajonero con 6 cajones espaciosos en Flor Morado. Máxima capacidad de almacenamiento.','1.30 x 0.40','Madera Flor Morado',4,'cajoneros'),(77,'CAJONERO FIGY',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776890493/CAJONERO_FIGY_t8z3oo.jpg','Cajonero Figy en lámina Flor Morado. Diseño geométrico único.','1.20 x 0.55','Lámina Flor Morado Natural',4,'cajoneros'),(78,'BIFE CLASICO',2080000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776890486/BIFE_CLASICO_pyxgtg.jpg','Bife clásico pintado color wash fondo natural. Diseño atemporal en pino/cedro.','1.50','Pintado Color Wash Fondo Natural, Pino/Cedro',4,'cajoneros'),(79,'BIFE ALISTONADO',3280000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776890501/BIFE_ALISTONADO_ytelfu.jpg','Bife alistonado en Flor Morado natural. Diseño con listones que aporta carácter.','1.40 x 0.45','Flor Morado Natural',4,'cajoneros'),(80,'BIFE NATURAL',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776890502/BIFE_NATURAL_s4xwdi.jpg','Bife natural en chapilla Flor Morado. Elegancia natural con acabado premium.','1.50 x 0.40','Chapilla Flor Morado Natural',4,'cajoneros'),(81,'SOFA CAMA SENSACION',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776921140/SOFA_CAMA_SENSACION_jhbbh5.jpg','Sofá cama Sensación con diseño moderno','1.80 x 0.90','Tapizado (Tela Antifluido), Patas Flor Morado Natural',2,'sofa_camas'),(82,'SOFA CAMA ROMA',3000000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776921138/SOFA_CAMA_ROMA_xiqftv.jpg','Sofá cama Roma elegante','1.80 x 0.90','Tapizado (Tela Antifluido), Patas Flor Morado Natural',2,'sofa_camas'),(83,'SOFA CAMA ROMA FAMILIAR',4100000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776921136/SOFA_CAMA_ROMA_FAMILIAR_s3xflc.jpg','Sofá cama Roma Familiar extenso','Parte Externa: 2.30 x 1.60 / Parte Interna: 1.90 x 1.90','Tapizado (Tela Antifluido), Patas Flor Morado Natural',2,'sofa_camas'),(84,'SOFA CAMA ROMA 1P',2040000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776921134/SOFA_CAMA_ROMA_1P_peztoa.jpg','Sofá cama Roma 1 puesto','Parte Externa: 1.00 x 0.90 / Parte Interna: 0.80 x 1.90','Tapizado (Tela Antifluido), Patas Flor Morado Natural',2,'sofa_camas'),(85,'SOFA CAMA LINEAL',3380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776921132/SOFA_CAMA_LINEAL_bqet7s.jpg','Sofá cama Lineal diseño limpio','1.80 x 0.90','Tapizado (Tela Antifluido), Patas Flor Morado Natural',2,'sofa_camas'),(86,'SOFA CAMA TORELLO TRES PUESTOS + PUFF',3880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776921147/SOFA_CAMA_TORELLO_TRES_PUESTOS_PUFF_zfydjl.jpg','Sofá cama Torello 3 puestos + puff','2.00 x 0.90','Tapizado (Tela Antifluido), Patas Flor Morado Natural',2,'sofa_camas'),(87,'SOFA CAMA TORELLO DOS PUESTOS',3140000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776921145/SOFA_CAMA_TORELLO_2_PUESTOS_mynflc.jpg','Sofá cama Torello 2 puestos','1.80 x 0.90','Tapizado (Tela Antifluido), Patas Flor Morado Natural',2,'sofa_camas'),(88,'SOFA CAMA TELAVID',3380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776921143/SOFA_CAMA_TELAVID_gmhars.jpg','Sofá cama TelaVid moderno','1.80 x 0.90','Tapizado (Tela Antifluido), Patas Flor Morado Natural',2,'sofa_camas'),(89,'SILLA AUX TOKIO',1480000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919966/SILLA_TOKIO_ir9i7g.jpg','Silla auxiliar Tokio','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(90,'SILLA AUX ROMEO',1580000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919964/SILLA_ROMEO_nlyldu.jpg','Silla auxiliar Romeo','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(91,'SILLA AUX ATLANTIS',1380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919959/SILLA_ATLANTIS_qmtrv1.jpg','Silla auxiliar Atlántis','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(92,'SILLA AUX ALICIA',1380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919958/SILLA_ALICIA_xghhat.jpg','Silla auxiliar Alicia','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(93,'SILLA AUX PRADA LINEAL',1480000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919963/SILLA_PRANA_LINEAL_xjsstr.jpg','Silla auxiliar Prada Lineal','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(94,'SILLA AUX SALAMANCA',1680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919965/SILLA_SALAMANCA_us7keb.jpg','Silla auxiliar Salamanca','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(95,'SILLA AUX NIDO',1180000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919961/SILLA_NIDO_rjk0gp.jpg','Silla auxiliar Nido','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(96,'SILLA AUX MECEDORA SALAMANCA',1780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919960/SILLA_MECEDORA_SALAMANCA_f3qb6g.jpg','Silla auxiliar mecedora Salamanca','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(97,'SILLA AUX PERLA LEATHER',1180000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776439386/silla_aux_perla_leather_joakga.jpg','Silla auxiliar Perla Leather','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(98,'SILLA AUX ZETA',1480000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919951/SILLA_ZETA_ty2bja.jpg','Silla auxiliar Zeta','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(99,'SILLA AUX ZAFIRO',1380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919950/SILLA_ZAFIRO_r6kz14.jpg','Silla auxiliar Zafiro','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(100,'SILLA AUX GEMINI',1580000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919945/SILLA_GEMINI_jbo0ju.jpg','Silla auxiliar Gémini','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(101,'SILLA AUX LIMA',1680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919947/SILLA_LIMA_etz3zo.jpg','Silla auxiliar Lima','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(102,'SILLA AUX MARBELLA',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919947/SILLA_MARBELLA_hfxx1h.jpg','Silla auxiliar Marbella','Standard','Madera Flor Morado, Tapizado, Fibra Natural Tejida',2,'sillas_aux'),(103,'SILLA AUX HONG KONG',1680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919945/SILLA_HONG_KONG_guk7m8.jpg','Silla auxiliar Hong Kong','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(104,'SILLA AUX GEMA',1680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919944/SILLA_GEMA_ekkvjc.jpg','Silla auxiliar Gema','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(105,'SILLA AUX CIRCON (Con descansa pies)',1880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920003/SILLA_CIRCON_CON_POSA_PIES_fzsj8w.jpg','Silla auxiliar Circon con descansa pies','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(106,'SILLA AUX L',1380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920006/SILLA_L_yyaq8k.jpg','Silla auxiliar forma L','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(107,'SILLA AUX ZARA',1680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920011/SILLA_ZARA_ppu044.jpg','Silla auxiliar Zara','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(108,'SILLA AUX GALAXY',2680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920004/SILLA_GALAXY_d5ajss.jpg','Silla auxiliar Galaxy','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(109,'SILLA AUX ARIA',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920001/SILLA_ARIA_tg13dg.jpg','Silla auxiliar Aria','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(110,'SILLA AUX BELLA',1580000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920002/SILLA_BELLA_nsrxpl.jpg','Silla auxiliar Bella','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(111,'SILLA AUX OCRE',1480000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920008/SILLA_OCRE_tpdt1m.jpg','Silla auxiliar Ocre','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(112,'SILLA AUX TERRA',1580000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920010/SILLA_TERRA_vp9bto.jpg','Silla auxiliar Terra','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(113,'SILLA AUX MECEDORA LACTANCIA',2780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776920007/SILLA_MECEDORA_LACTANCIA_jp3aqv.jpg','Silla auxiliar mecedora Lactancia','Standard','Madera Flor Morado, Tapizado',2,'sillas_aux'),(114,'MESA TV PRISMA',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919352/MESA_PRISMA_aewiu8.jpg','Mesa TV Prisma','1.60 Largo','Madera Flor Morado Natural',2,'mesas_tv'),(115,'MESA TV SANTA MARTA',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919355/MESA_SANTA_MARTA_sq7qe0.jpg','Mesa TV Santa Marta','1.60 Largo','Madera Flor Morado Natural',2,'mesas_tv'),(116,'MESA TV NATURAL ONE',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919351/MESA_NATURAL_ONE_lijdml.jpg','Mesa TV Natural One','1.60 Largo','Madera Flor Morado Natural, Chapilla Natural',2,'mesas_tv'),(117,'MESA TV REJILLA',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919353/MESA_REJILLA_khaq6q.jpg','Mesa TV Rejilla','1.60 Largo','Madera Flor Morado Natural',2,'mesas_tv'),(118,'MESA TV SAN DIEGO',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919354/MESA_SAN_DIEGO_wtou38.jpg','Mesa TV San Diego','1.60 Largo','Madera Flor Morado Natural',2,'mesas_tv'),(119,'MESA TV ALISTONADA',2380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919350/MESA_ALISTONADA_i53dbs.jpg','Mesa TV Alistonada','2.00','Madera Flor Morado Natural',2,'mesas_tv'),(120,'MESA TV NATURA',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776919351/MESA_NATURA_nbkldk.jpg','Mesa TV Natura','1.20','Cedro Rosado',2,'mesas_tv'),(121,'MESA TV PARALELA',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776442773/mesa_tv_paralela_mdavdy.jpg','Mesa TV Paralela','1.60','Madera Flor Morado Natural',2,'mesas_tv'),(122,'MESA TV MIAMI CON CAJONES',1980000.00,'','Mesa TV Miami con cajones','1.60','Madera Flor Morado Natural',2,'mesas_tv'),(123,'BASE FIGY RECTA',2680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434588/base_figy_recta_dweel1.jpg','Base Figy Recta','1.60 x 1.00 (6 Puestos)','Cubierta en Chapilla Flor Morado, Base en Madera Flor Morado',3,'comedores'),(124,'BASE REJILLA',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434597/base_rejilla_ot3iaq.jpg','Base Rejilla','1.60 x 1.00 (6 Puestos)','Cubierta Lamina Flor Morado, Base Rejilla en Cedro',3,'comedores'),(125,'BASE FIRENZE',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434591/base_firenze_abgsqi.jpg','Base Firenze','1.60 x 1.00 (6 Puestos)','Flor Morado Natural',3,'comedores'),(126,'BASE MAKANA',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434593/base_makana_exndzs.jpg','Base Makana','Cubierta 120 Diametro (4 Puestos)','Flor Morado Natural, Cubierta Tecnica Metalizada Gris',3,'comedores'),(127,'BASE FILLY OVALADA',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434589/base_filly_ovalada_ofy8js.jpg','Base Filly Ovalada','1.60 x 1.00 (6 Puestos)','Lamina Flor Morado',3,'comedores'),(128,'BASE ONDARA',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434596/base_ondara_lumjor.jpg','Base Ondara','1.35 x 0.90 (4 Puestos)','Madera Flor Morado',3,'comedores'),(129,'BASE FIGY 2S',4980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434612/base_figy_25_lrl8bc.jpg','Base Figy 2S','1.60 x 0.80 Centro 0.90 (6 Puestos)','Cubierta Sinterizada, Base Figy Recta Flor Morado',3,'comedores'),(130,'BASE SANTA MARIA',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434599/base_santa_maria_xkzp9p.jpg','Base Santa Maria','1.60 x 1.00 (6 Puestos)','Madera Flor Morado',3,'comedores'),(131,'BASE TESLA',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434603/base_tesla_dk7e4c.jpg','Base Tesla','1.80 x 1.00 (6 Puestos)','Madera Flor Morado',3,'comedores'),(132,'BASE ABANICA',2180000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434606/base_abanica_t29w0i.jpg','Base Abanica','Cubierta 120 Diametro (4 Puestos)','Cubierta Chapilla, Base Madera Flor Morado',3,'comedores'),(133,'BASE MARBELLA',2780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434594/base_marbella_djsfjv.jpg','Base Marbella','1.50 x 1.00 (6 Puestos)','Cubierta Chapilla, Base Madera Flor Morado',3,'comedores'),(134,'BASE 2K',1480000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434605/base_2k_raixja.jpg','Base 2K','1.20 x 0.90 (4 Puestos)','Cubierta Vidrio 10mm, Base Flor Morado Natural',3,'comedores'),(135,'BASE MACARENA',3380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434592/base_macarena_qglc6c.jpg','Base Macarena','1.60 x 1.10 (6 Puestos)','Cubierta Roble Flor Morado, Base Cedro Rosado',3,'comedores'),(136,'BASE ZENNA',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434604/base_zenna_d69ukg.jpg','Base Zenna','1.60 x 0.90 (6 Puestos)','Roble Flor Morado',3,'comedores'),(137,'BASE DIAMANTE',1980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434610/base_diamante_xtl65a.jpg','Base Diamante','1.20 x 0.90 (4 Puestos)','Lamina Flor Morado',3,'comedores'),(138,'BASE FIGY CURVA',4980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434613/base_figy_curva_tazuuk.jpg','Base Figy Curva','2.20 x 0.90 (8 Puestos)','Cubierta Piedra Sinterizada, Base Figy Curva Flor Morado',3,'comedores'),(139,'BASE FIGY CURVA SS',2680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434587/base_figy_curva_ss_qi0dvo.jpg','Base Figy Curva SS','1.30 x 0.90 (4 Puestos)','Cubierta Lamina Flor Morado, Base Figy Curva Flor Morado',3,'comedores'),(140,'BASE INDUSTRIAL',0.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434590/base_industrial_od6kyt.jpg','Base Industrial','Medida Irregular 2.80 x 1.10 (6 Puestos)','Cubierta de Tronco Natural, Base Metal',3,'comedores'),(141,'BASE SINTERIZADA BRILLO',2680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434602/base_sinterizada_brillo_yyby2n.jpg','Base Sinterizada Brillo (Linea Economica)','1.60 x 0.90 (6 Puestos)','Cubierta Sinterizada, Base Flor Morado Natural',3,'comedores'),(142,'BASE SERENA',3380000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434601/base_serena_oklrhb.jpg','Base Serena','1.60 Largo, 0.95 Centro, 0.90 Extremos (6 Puestos)','Flor Morado Natural',3,'comedores'),(143,'BASE SAN DIEGO',2480000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434598/base_san_diego_n7xzbz.jpg','Base San Diego','1.20 x 0.90 (4 Puestos)','Flor Morado Natural',3,'comedores'),(144,'BASE CONICA',2980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434609/base_conica_gh4pfe.jpg','Base Conica','1.60 x 1.00 (6 Puestos)','Flor Morado Natural',3,'comedores'),(145,'BASE AHORRA ESPACIO',2880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776434608/base_ahorra_espacio_j6ahbc.jpg','Base Ahorra Espacio','Cubierta 1.00 Diametro (4 Puestos)','Cedro / Flor Morado',3,'comedores'),(146,'SILLA COMEDOR',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435768/silla_comedor_mtm71a.jpg','Silla Comedor','Standard','Madera Flor Morado',3,'sillas_comedor'),(147,'SILLA COMEDOR DUBAI',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435753/silla_comedor_dubai_fchhkf.jpg','Silla Comedor Dubai','Standard','Madera Flor Morado',3,'sillas_comedor'),(148,'SILLA COMEDOR GEMA 2',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435767/silla_cmedor_gema_2_zvr8i2.jpg','Silla Comedor Gema 2','Standard','Madera Flor Morado',3,'sillas_comedor'),(149,'SILLA COMEDOR NATIVA',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435759/silla_comedor_nativa_cqan2q.jpg','Silla Comedor Nativa','Standard','Madera Flor Morado',3,'sillas_comedor'),(150,'SILLA COMEDOR LIMA',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435757/silla_comedor_lima_cx61vw.jpg','Silla Comedor Lima','Standard','Madera Flor Morado',3,'sillas_comedor'),(151,'SILLA COMEDOR FILIPHINA',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435754/silla_comedor_filiphina_uv7yvz.jpg','Silla Comedor Filiphina','Standard','Madera Flor Morado',3,'sillas_comedor'),(152,'SILLA COMEDOR TURQUESA',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435766/silla_comedor_turquesa_phmrld.jpg','Silla Comedor Turquesa','Standard','Madera Flor Morado',3,'sillas_comedor'),(153,'SILLA COMEDOR JAPAN',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435756/silla_comedor_japan_fjdhaj.jpg','Silla Comedor Japan','Standard','Madera Flor Morado',3,'sillas_comedor'),(154,'SILLA COMEDOR DIAMANTE',580000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435775/silla_comedor_diamante_pqnfqo.jpg','Silla Comedor Diamante','Standard','Madera Flor Morado',3,'sillas_comedor'),(155,'SILLA COMEDOR ROBLE',680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435764/silla_comedor_roble_yjt2ey.jpg','Silla Comedor Roble','Standard','Madera Flor Morado',3,'sillas_comedor'),(156,'SILLA COMEDOR ESMERALDA',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435754/silla_comedor_esmeeralda_r6ckg8.png','Silla Comedor Esmeralda','Standard','Madera Flor Morado',3,'sillas_comedor'),(157,'SILLA COMEDOR RETIRO',580000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435762/silla_comedor_retiro_g75q7g.png','Silla Comedor Retiro','Standard','Madera Flor Morado',3,'sillas_comedor'),(158,'SILLA COMEDOR ALEXA',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435771/silla_comedor_alexa_gsqyjj.png','Silla Comedor Alexa','Standard','Madera Flor Morado',3,'sillas_comedor'),(159,'SILLA COMEDOR RETRO CURVA',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435763/silla_comedor_retro_curva_etvp1c.png','Silla Comedor Retro Curva','Standard','Madera Flor Morado',3,'sillas_comedor'),(160,'SILLA COMEDOR CLASICA',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435774/silla_comedor_clasica_xk5wqq.png','Silla Comedor Clasica','Standard','Cedro Rosado',3,'sillas_comedor'),(161,'SILLA COMEDOR AMATISTA',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435772/silla_comedor_amatista_qretvx.png','Silla Comedor Amatista','Standard','Madera Flor Morado',3,'sillas_comedor'),(162,'SILLA COMEDOR ORION',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776435760/silla_comedor_orion_vpx6nx.png','Silla Comedor Orion','Standard','Madera Flor Morado',3,'sillas_comedor'),(163,'SILLA DE BARRA JAPAN',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916797/SILLA_JAPAN_ynk453.jpg','Silla de Barra Japan','Standard','Flor Morado Natural',3,'sillas_barra'),(164,'SILLA DE BARRA MIMBRE',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916798/SILLA_MIMBRE_colats.jpg','Silla de Barra Mimbres','Standard','Flor Morado Natural',3,'sillas_barra'),(165,'SILLA DE BARRA AMATISTA',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916830/SILLA_AMATISTA_cc17zi.jpg','Silla de Barra Amatista','Standard','Flor Morado Natural',3,'sillas_barra'),(166,'SILLA DE BARRA LIOR',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916798/SILLA_LIOR_wppg4s.jpg','Silla de Barra Lior','Standard','Flor Morado Natural',3,'sillas_barra'),(167,'SILLA DE BARRA JJ',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916797/SILLA_J-J_rbwadk.jpg','Silla de Barra JJ','Standard','Flor Morado Natural',3,'sillas_barra'),(168,'SILLA DIAMANTE',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916832/SILLA_DIAMANTE_xhzvmh.jpg','Silla Diamante','Standard','Flor Morado Natural',3,'sillas_barra'),(169,'SILLA CURVA INDUSTRIAL',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916830/SILLA_CURVA_INDUSTRIAL_gmsr9k.jpg','Silla Curva Industrial','Standard','Flor Morado Natural',3,'sillas_barra'),(170,'SILLA ICONO',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916796/SILLA_ICONO_jvdgkk.jpg','Silla Icono','Standard','Flor Morado Natural',3,'sillas_barra'),(171,'SILLA CURVA',680000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916831/SILLA_CURVA_k7w1qx.jpg','Silla Curva','Standard','Flor Morado Natural',3,'sillas_barra'),(172,'SILLA VENECIA',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916754/SILLA_VENECIA_gll9ep.jpg','Silla Venecia','Standard','Flor Morado Natural',3,'sillas_barra'),(173,'SILLA ZETA V',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916754/SILLA_ZETA_V_gbf1a2.jpg','Silla Zeta V','Standard','Flor Morado Natural',3,'sillas_barra'),(174,'SILLA DUBAI',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916833/SILLA_DUBAI_q5wals.jpg','Silla Dubai','Standard','Flor Morado Natural',3,'sillas_barra'),(175,'SILLA GEMA FLOR',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916834/SILLA_GEMA_FLOR_c0bogj.jpg','Silla Gema Flor','Standard','Flor Morado Natural',3,'sillas_barra'),(176,'SILLA TAILANDIA',880000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916753/SILLA_TAILANDIA_jqsz7f.jpg','Silla Tailandia','Standard','Flor Morado Natural',3,'sillas_barra'),(177,'SILLA TORINO',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916754/SILLA_TORINO_bfrwxf.jpg','Silla Torino','Standard','Pino',3,'sillas_barra'),(178,'SILLA INDUSTRIAL',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916796/SILLA_INDUSTRIAL_ouqlid.jpg','Silla Industrial','Standard','Flor Morado Natural',3,'sillas_barra'),(179,'SILLA ROBLE',780000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916753/SILLA_ROBLE_vqgeki.jpg','Silla Roble','Standard','Flor Morado Natural',3,'sillas_barra'),(180,'SILLA FILIPHINA',980000.00,'https://res.cloudinary.com/dj5dehk8y/image/upload/v1776916833/SILLA_FILIPGINA_qe90wv.jpg','Silla Filiphina','Standard','Flor Morado Natural',3,'sillas_barra');
/*!40000 ALTER TABLE `productos` ENABLE KEYS */;
UNLOCK TABLES;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-29 10:18:29

------------------------------------------

-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: mysql-314c74b4-juandavidrestrepobetancur756-c1fe.d.aivencloud.com    Database: defaultdb
-- ------------------------------------------------------
-- Server version	8.0.45

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '95e4d4de-3cc5-11f1-85d1-ee10f6ee547d:1-541,
a01756ef-3d92-11f1-b8e4-f68cc5415069:1-1318';

--
-- Table structure for table `usuarios`
--

DROP TABLE IF EXISTS `usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `telefono` varchar(20) NOT NULL,
  `nombre` varchar(100) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `last_interaction` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `telefono` (`telefono`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `usuarios`
--

LOCK TABLES `usuarios` WRITE;
/*!40000 ALTER TABLE `usuarios` DISABLE KEYS */;
INSERT INTO `usuarios` VALUES (1,'+573217723086',NULL,'2026-04-20 14:48:24','2026-04-29 14:38:23'),(2,'+573102536676',NULL,'2026-04-28 13:09:41','2026-04-28 13:19:05');
/*!40000 ALTER TABLE `usuarios` ENABLE KEYS */;
UNLOCK TABLES;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-29 10:18:13

-------------------------------------------

-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: mysql-314c74b4-juandavidrestrepobetancur756-c1fe.d.aivencloud.com    Database: defaultdb
-- ------------------------------------------------------
-- Server version	8.0.45

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '95e4d4de-3cc5-11f1-85d1-ee10f6ee547d:1-541,
a01756ef-3d92-11f1-b8e4-f68cc5415069:1-1318';

--
-- Table structure for table `citas`
--

DROP TABLE IF EXISTS `citas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `citas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `telefono` varchar(20) NOT NULL,
  `nombre` varchar(100) DEFAULT NULL,
  `dia` varchar(20) DEFAULT NULL,
  `hora` varchar(20) DEFAULT NULL,
  `razon` text,
  `ubicacion` int DEFAULT NULL,
  `estado` enum('pendiente','confirmada','cancelada') DEFAULT 'pendiente',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `usuario_id` (`usuario_id`),
  CONSTRAINT `citas_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `citas`
--

LOCK TABLES `citas` WRITE;
/*!40000 ALTER TABLE `citas` DISABLE KEYS */;
INSERT INTO `citas` VALUES (1,1,'+573217723086','Juan David','Lunes','14:30','Ver unos productos que me interesan',2,'pendiente','2026-04-27 13:30:55'),(2,1,'+573217723086','Juan david','Sabado','09:00','me gustaria ver varios muebles',3,'pendiente','2026-04-27 21:24:14'),(3,1,'+573217723086','carlos','Viernes','14:45','me gustaria ir a ver sillas',3,'pendiente','2026-04-27 21:34:04'),(4,1,'+573217723086','mi nombre es Jhoan','Sabado','11:00','Voy a ver minimalismo',3,'pendiente','2026-04-28 14:15:46');
/*!40000 ALTER TABLE `citas` ENABLE KEYS */;
UNLOCK TABLES;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-29 10:18:23

