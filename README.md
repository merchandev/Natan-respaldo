# Natan Electronics · despliegue en VPS Hostinger

Entrega preparada el **26 de octubre de 2026** a partir del respaldo local. El contenido de la base fue exportado el **19 de octubre de 2026**; no es una exportación nueva de producción.

Los **61 archivos de `codigo-fuente/` se conservan byte por byte**. El servidor Node y la configuración Docker se añadieron por separado. La web y las API corren en el VPS; la aplicación sigue usando **Supabase** para PostgreSQL, autenticación y Storage. No basta con instalar MySQL o PostgreSQL sin los servicios de Supabase.

## Contenido completo

| Ruta | Contenido |
|---|---|
| `codigo-fuente/` | Tienda, panel, páginas, recursos e integraciones originales |
| `respaldo-cifrado/` | Los **2.327 archivos originales**, incluidos datos SQL/CSV/JSON, **2.238 fotos**, PDF, ZIP de entrega y todo el código |
| `deploy/` | Adaptador Node, Caddy, recuperación del respaldo, carga de fotos, pruebas y actualización del VPS |
| `Dockerfile`, `compose.yaml` | Aplicación y proxy con HTTPS automático al configurar un dominio |
| `.github/workflows/` | Validación automática y despliegue manual por SSH |
| `INVENTARIO.json` | Cantidades y SHA-256 de cada archivo de código original |
| `REVISION.md` | Hallazgos y límites de esta entrega |

El repositorio es público por elección del propietario. Los datos y documentos de la entrega se publican **cifrados con AES-256-GCM** en seis partes de hasta 45 MiB. La clave aleatoria de 256 bits se entrega en el archivo local `CLAVE-RESPALDO-NATAN.key.txt`, **fuera del repositorio**. Guárdala por separado: GitHub no permite recuperarla. La clave pública `anon` del frontend original se conserva; no es la clave privada `service_role`.

## 1. Preparar el VPS

Usar un VPS Linux con Docker Engine y Docker Compose v2, Git y puertos 80/443 disponibles. La plantilla Docker de Hostinger incluye Docker y Compose. Si ya existe un proxy ocupando esos puertos, integrar la aplicación con él antes de iniciar este Compose.

```sh
git clone https://github.com/merchandev/old_natan.git /opt/old_natan
cd /opt/old_natan
cp .env.example .env
chmod 600 .env
nano .env
```

Completar las credenciales reales de Supabase, D3xD y BNC en `.env`. Están ausentes del respaldo original y no pueden reconstruirse a partir de estos archivos. Para conservar la base actual, usar el mismo proyecto Supabase que figura en los HTML y dejar vacías las dos variables `FRONTEND_SUPABASE_*`.

Para probar por IP, mantener `SITE_ADDRESS=:80`. Para HTTPS, apuntar el registro DNS A del dominio al VPS y usar, por ejemplo, `SITE_ADDRESS=tienda.ejemplo.com`. Se pueden indicar varios nombres separados por coma. Usar `natanelectronics.com` requiere controlar su DNS; no se cambió desde esta entrega. Para BNC, configurar también el subdominio del webhook y autorizar la IP fija del VPS en el banco.

```sh
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
curl --fail http://127.0.0.1/healthz
```

Con un dominio HTTPS configurado, consultar `https://TU-DOMINIO/healthz`. `/healthz` comprueba el servidor local; no acredita conexión con Supabase o BNC. La tienda está en `/`, el panel en `/admin`, y el estado en `/estado`. El servidor solo publica los archivos web previstos; los SQL, el respaldo, los helpers y las variables no son descargables por HTTP.

## 2. Recuperar la base y el contenido completo

Este paso recupera archivos locales. **No ejecuta SQL ni cambia producción.** Se necesita Node.js 24 en el equipo donde se vaya a descifrar; también puede hacerse en este PC y transferir el resultado por SSH.

Copiar la clave al VPS mediante un canal privado y guardarla fuera del clon, por ejemplo `/root/CLAVE-RESPALDO-NATAN.key.txt`, con permisos `600`. No pegarla en GitHub, en un issue ni en el historial de un comando.

```sh
cd /opt/old_natan
node deploy/backup.mjs unpack respaldo-cifrado /root/CLAVE-RESPALDO-NATAN.key.txt respaldo-restaurado
```

Si el VPS solo tiene Docker y no tiene Node instalado, usar en su lugar:

```sh
docker run --rm -v "$PWD:/work" -v /root/CLAVE-RESPALDO-NATAN.key.txt:/run/natan.key:ro -w /work node:24-alpine node deploy/backup.mjs unpack respaldo-cifrado /run/natan.key respaldo-restaurado
```

El destino debe ser una carpeta nueva. La herramienta verifica las partes, autentica el cifrado antes de extraer y comprueba el SHA-256 de cada archivo. Se recuperan exactamente estas carpetas originales:

```text
respaldo-restaurado/
├── datos/
│   ├── datos_natan.sql
│   ├── csv/
│   ├── json/
│   └── fotos/natan-products/
└── Entrega final Natan Electronics - copia/
    ├── codigo-fuente/
    ├── documentos/
    ├── codigo-fuente-natan-electronics.zip
    └── Informe de cierre — Natan Electronics.pdf
```

`respaldo-restaurado/` está excluida de Git. El SQL contiene 3.324 productos, 1.297 respaldos de fotos por código, 60 clientes, un pedido, categorías, banners, marcas, clientes de portada, configuración e historial BCV.

## 3. Restaurar en otro Supabase (solo si se cambia de base)

Si se conserva el Supabase actual, **no importar el respaldo sobre producción**. Para una migración, preparar un proyecto Supabase nuevo y vacío, administrado o autoalojado con su stack oficial.

1. Ejecutar `codigo-fuente/basededatos/esquema_completo.sql` en el SQL Editor del proyecto nuevo.
2. Ejecutar `respaldo-restaurado/datos/datos_natan.sql` en ese mismo proyecto. Con `psql`, activar `-v ON_ERROR_STOP=1`.
3. Crear un bucket público `natan-products` y subir las 2.238 fotos con sus nombres intactos. El script siguiente crea el bucket si falta y puede reanudarse porque usa upsert. Antes de ejecutarlo, poner en `.env` la URL y la `SUPABASE_SERVICE_ROLE_KEY` **del proyecto nuevo**:

```sh
node --env-file=.env deploy/restore-storage.mjs respaldo-restaurado/datos/fotos/natan-products
```

4. Al final del SQL de datos están los `UPDATE` comentados para sustituir el host antiguo de las fotos. Cambiar `NUEVO-PROYECTO` por el proyecto nuevo y ejecutarlos. Si se autoaloja Supabase, usar su URL pública completa en esas sustituciones.
5. Crear de nuevo los usuarios en Supabase Authentication y registrar al menos un `admin` en `natan_admins`; el respaldo solo inserta dos operadores. Configurar Site URL y Redirect URLs para el dominio del VPS. No existen contraseñas ni exportación de `auth.users` en el material recibido.
6. Configurar permisos de Storage para permitir cargas del panel a los administradores. El bloque final de `basededatos/rls_permisos_por_rol.sql` contiene las tres políticas de Storage. **No ejecutar el archivo completo después de `esquema_completo.sql`**: repite nombres de políticas y produciría errores.
7. Configurar `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` del backend. Completar además `FRONTEND_SUPABASE_URL` y `FRONTEND_SUPABASE_ANON_KEY` con la URL pública y la clave pública del nuevo proyecto. El adaptador sustituye esas dos constantes en la respuesta HTML, conservando los archivos originales intactos.
8. Reiniciar con `docker compose up -d --force-recreate --wait` y validar login, catálogo, fotos, pedidos y sincronización con credenciales reales.

No ejecutar `migration.sql`: es una migración antigua para tablas sin prefijo `natan_`. El esquema recibido no reconstruye el contador de visitas y conserva políticas públicas para clientes/pedidos; consultar `REVISION.md` antes de habilitar un proyecto nuevo.

## 4. Desplegar desde GitHub

El workflow **Desplegar en VPS Hostinger** usa SSH y se ejecuta manualmente desde Actions → Run workflow. Antes debe existir `/opt/old_natan` en el VPS, con su `.env` configurado, y el usuario SSH debe poder actualizar esa carpeta y ejecutar Docker.

Crear estos secrets en GitHub, idealmente en el environment `production`:

| Secret | Valor |
|---|---|
| `VPS_HOST` | IP o hostname del VPS |
| `VPS_USER` | Usuario SSH |
| `VPS_PORT` | Puerto SSH, opcional; por defecto 22 |
| `VPS_SSH_KEY` | Clave privada del usuario de despliegue; instalar su pública en `authorized_keys` |
| `VPS_KNOWN_HOSTS` | Entrada de host SSH comprobada con la huella del VPS por un canal confiable |

Las credenciales de la aplicación permanecen en `.env` del VPS. La clave del respaldo no se necesita para actualizar el servidor y no debe añadirse al workflow. El workflow de despliegue no se activa automáticamente al subir cambios. Para actualizar manualmente por SSH:

```sh
cd /opt/old_natan
sh deploy/update.sh
```

## Verificaciones realizadas

- Imagen Docker construida con el lockfile original; `npm ci` informó cero vulnerabilidades.
- Pruebas HTTP del adaptador: páginas originales, rutas PHP, autenticación, lectura cruda de D3xD, bloqueo de archivos internos y configuración opcional del frontend.
- Comprobación de SHA-256 de los 61 archivos originales y sintaxis de 28 bloques/scripts JavaScript.
- Descifrado y comparación completa de los 2.327 archivos del respaldo.
- Restauración de esquema y datos en PostgreSQL 17 temporal con roles y función `auth.jwt()` simulados; coincidencia de cantidades. Esto no sustituye una prueba de Supabase Auth, Storage o RLS en producción.
- Las 2.008 referencias distintas a fotos de los JSON tienen archivo local; el respaldo conserva también las fotos no referenciadas.
- Prueba completa de Compose con Caddy: aplicación saludable y HTTP 200 en tienda y panel. Una clave incorrecta rechazó la recuperación sin extraer archivos.

No se accedió al VPS, no se modificó el DNS ni la base actual y no se realizaron operaciones bancarias. Para la puesta en servicio faltan los accesos del VPS y las credenciales de las integraciones.

Fuentes oficiales de referencia: [Docker en Hostinger](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/), [Supabase autoalojado](https://supabase.com/docs/guides/self-hosting/docker), [restauración a Supabase autoalojado](https://supabase.com/docs/guides/self-hosting/restore-from-platform).
