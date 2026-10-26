# Revisión del material recibido

Fecha: 26 de octubre de 2026. Se conservó el código original; los hallazgos siguientes se documentan y no se corrigen dentro de él.

## Arquitectura y adaptación

La aplicación contiene HTML/JavaScript sin compilación, funciones CommonJS para Vercel, una dependencia `crypto-js` y Supabase REST/Auth/Storage. El adaptador usa Node 24 para servir los mismos HTML e invocar las mismas funciones. El Compose actual publica únicamente el puerto configurable 18091 directamente al contenedor. No instala un proxy ni toca Traefik.

### Ajuste para el VPS compartido

El primer intento en Hostinger construyó y arrancó la aplicación, pero falló al montar `deploy/Caddyfile`: el archivo no estaba disponible como archivo en el directorio de ejecución `/docker/natan`. Se eliminó el servicio Caddy y el montaje; también se eliminó la dependencia obligatoria de `.env`, usando variables explícitas de Compose compatibles con el panel.

El proyecto predeterminado es `natan-respaldo`, separado de `natan-electronics`. No utiliza IP fija ni redes externas, volúmenes del host o nombres globales de contenedor. Traefik queda deshabilitado para este contenedor y no se publican 80/443. El puerto 18091 no figura entre los publicados en la captura; su disponibilidad real debe verificarse en el VPS. El contenedor tiene límites de CPU, memoria y procesos, pero la construcción de la imagen también consume recursos.

El archivo llamado `push pull up.json` contiene las reglas de rutas que Vercel esperaría en `vercel.json`. El adaptador lee ese archivo tal cual. Los directorios SQL se llaman `basededatos/`, aunque el README original menciona `supabase/`. Dentro del ZIP de entrega sí están los nombres originales `vercel.json` y `supabase/`, así como `.github/workflows/update-bcv.yml`, que falta en la carpeta extraída. Al normalizar esos nombres, los archivos compartidos por ZIP y carpeta son idénticos. Se preservó el ZIP entero en el respaldo cifrado.

El workflow antiguo BCV sigue dentro del ZIP y no se activó: ejecutarlo requeriría configurar su secreto y podría escribir sobre el Supabase original. Los workflows añadidos solo validan y permiten un despliegue manual por SSH.

## Datos incluidos y ausentes

| Tabla exportada | Filas |
|---|---:|
| natan_products | 3.324 |
| natan_product_photos | 1.297 |
| natan_customers | 60 |
| natan_orders | 1 |
| natan_categories | 7 |
| natan_banners | 1 |
| natan_brands | 8 |
| natan_clients | 7 |
| natan_bcv_history | 40 |
| natan_settings | 8 |

Además, el SQL inserta dos operadores en `natan_admins`. No hay usuarios/contraseñas de Supabase Auth, credenciales privadas BNC/D3xD, exportación de notificaciones bancarias ni un dump físico completo del servidor PostgreSQL. Se incluyó **todo lo existente en el respaldo local**, no datos ausentes o posteriores al 19 de octubre.

Hay 2.238 fotos y 2.008 rutas distintas referenciadas por el contenido JSON; todas estas referencias existen localmente. El esquema y los datos se restauraron sin error en una instancia temporal de PostgreSQL 17 preparada con roles de prueba y una función `auth.jwt()` simulada. Se verificó compatibilidad SQL y cantidades, no autenticación real ni comportamiento de los servicios Supabase.

## Comportamientos originales a tener presentes

1. **Lectura pública de clientes y pedidos.** El esquema permite `SELECT` a `anon` sobre ambas tablas y actualizaciones públicas de clientes. La clave `anon` está en los HTML, como corresponde al frontend Supabase. La privacidad del respaldo cifrado no corrige esos permisos de la aplicación. El flujo actual de «Mi cuenta» depende de esas políticas. Corregirlas requiere cambios de aplicación/RLS fuera del alcance solicitado.
2. **Contador de visitas incompleto.** El frontend invoca `increment_product_views` y utiliza `views`, pero ni esa función ni esa columna están en `esquema_completo.sql` o en el export de productos. Al recrear la base, esa función de estadísticas no queda reconstruida.
3. **Storage requiere políticas adicionales.** El esquema completo no trae las políticas de subida/borrado de fotos. Están al final de `rls_permisos_por_rol.sql`; no se debe reaplicar todo ese archivo después del esquema completo porque duplica políticas.
4. **Dependencias externas conservadas.** Se conservan Supabase y recursos CDN del frontend. El VPS por sí solo no proporciona autenticación ni APIs de almacenamiento compatibles.
5. **Diagnóstico con dominio fijo.** `api/status.js` consulta `https://natanelectronics.com` para D3xD/BNC. Si se despliega en otro dominio, ese diagnóstico seguirá comprobando el dominio original. `/healthz` permite comprobar solo el nuevo proceso local.
6. **Integraciones bancarias.** BNC exige credenciales y lista blanca de IP. Envío P2P y cobro C2P permanecen deshabilitados con HTTP 503 por el código original.
7. **Logs originales.** La autenticación D3xD registra fragmentos de tokens y algunos errores incluyen información del backend. El adaptador mantiene ese comportamiento. Deben restringirse los accesos a los logs del VPS.
8. **Restauración en una base vacía.** El SQL usa `ON CONFLICT DO NOTHING`; no es una herramienta de sincronización de una base existente. Importarlo sobre producción puede mezclar estados antiguos con actuales.

## Protección del respaldo público

Se cifraron las dos carpetas originales completas: código, documentos, ZIP, SQL, CSV, JSON y fotos. Cada archivo incluye su SHA-256 dentro del contenedor cifrado. El manifiesto público contiene únicamente cantidades, tamaños, hashes de las partes cifradas, nonce y etiqueta de autenticación; no contiene la clave. El cifrado usa AES-256-GCM con clave aleatoria, no una contraseña débil.

La copia de código publicada fuera del respaldo es idéntica a la recibida; los JWT encontrados en ella tienen rol `anon`. No se encontraron archivos de claves privadas ni variables de integración con valores reales dentro de esa copia. El contenido privado recuperado, la clave y `.env` están excluidos del índice Git y del contexto Docker.

## Resultado y alcance de las pruebas

Se construyó la imagen Docker, se validó el Compose independiente sin archivos externos, se probó el adaptador HTTP con servicios externos simulados, se comprobó la sintaxis y se restauraron SQL y cifrado localmente. El manifiesto `INVENTARIO.json` permite detectar cambios en los originales.

La puesta en servicio en Hostinger, HTTPS del dominio real, login del panel, carga de fotos con Auth real y conexión BNC/D3xD necesitan credenciales del propietario. No se afirma una validación de producción sin esas credenciales.
