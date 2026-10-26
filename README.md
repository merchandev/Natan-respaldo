# Natan Electronics · despliegue en VPS Hostinger

Entrega preparada el **26 de octubre de 2026** a partir del respaldo local. El contenido de la base fue exportado el **19 de octubre de 2026**; no es una exportación nueva de producción.

Los **61 archivos de `codigo-fuente/` se conservan byte por byte**. El servidor Node y la configuración Docker se añadieron por separado. La web y las API corren en el VPS; la aplicación sigue usando **Supabase** para PostgreSQL, autenticación y Storage. No basta con instalar MySQL o PostgreSQL sin los servicios de Supabase.

## Contenido completo

| Ruta | Contenido |
|---|---|
| `codigo-fuente/` | Tienda, panel, páginas, recursos e integraciones originales |
| `respaldo-cifrado/` | Los **2.327 archivos originales**, incluidos datos SQL/CSV/JSON, **2.238 fotos**, PDF, ZIP de entrega y todo el código |
| `deploy/` | Adaptador Node, recuperación del respaldo, carga de fotos, pruebas y actualización del VPS |
| `Dockerfile`, `compose.yaml` | Un contenedor independiente, HTTP en el puerto configurable 18091 |
| `.github/workflows/` | Validación automática y despliegue manual por SSH |
| `INVENTARIO.json` | Cantidades y SHA-256 de cada archivo de código original |
| `REVISION.md` | Hallazgos y límites de esta entrega |

El repositorio es público por elección del propietario. Los datos y documentos de la entrega se publican **cifrados con AES-256-GCM** en seis partes de hasta 45 MiB. La clave aleatoria de 256 bits se entrega en el archivo local `CLAVE-RESPALDO-NATAN.key.txt`, **fuera del repositorio**. Guárdala por separado: GitHub no permite recuperarla. La clave pública `anon` del frontend original se conserva; no es la clave privada `service_role`.

## 1. Desplegar desde el repositorio en Hostinger

En **Administrador de Docker → Componer desde URL**:

| Campo | Valor |
|---|---|
| Repositorio | `https://github.com/merchandev/Natan` |
| Rama | `main` |
| Archivo Compose | `compose.yaml` |
| Nombre del proyecto nuevo | **`natan-respaldo`** |
| Puerto publicado | **`18091` → `3000` interno** |

Crear un proyecto separado con ese nombre. **No editar ni reemplazar `natan-electronics`**, que ya está funcionando con su propia base. El intento fallido llamado `natan` puede permanecer detenido; este paquete no lo elimina ni reutiliza sus volúmenes. Si hPanel conserva un editor Compose del intento anterior, volver a importar el archivo actualizado: debe mostrar solo el servicio `app`, sin `proxy`, `caddy` ni `volumes`.

En las variables del proyecto se puede pegar el contenido de `.env.example` y completar los valores necesarios. Para el arranque básico bastan estos valores, que ya son los predeterminados:

```dotenv
NATAN_HTTP_PORT=18091
NATAN_BIND_ADDRESS=0.0.0.0
```

No hay un `.env` obligatorio ni montajes de archivos del host. Así se evita el error de `/docker/natan/deploy/Caddyfile` cuando Hostinger compila desde una carpeta temporal y ejecuta desde otra. Todo el código necesario está dentro de la imagen.

Después de implementar, el acceso previsto es:

- Tienda: `http://72.62.86.94:18091/`
- Panel: `http://72.62.86.94:18091/admin`
- Salud local: `http://72.62.86.94:18091/healthz`

Estas direcciones son el destino previsto, **no una confirmación de disponibilidad en el VPS**. `/healthz` comprueba el proceso local; no acredita conexión con Supabase o BNC. No enviar credenciales reales del panel por HTTP: para uso habitual, configurar un dominio HTTPS en el proxy existente mediante una ruta nueva y dedicada. Este paquete no cambia Traefik, DNS ni sus redes automáticamente.

### Puertos y convivencia con los proyectos existentes

La captura facilitada muestra publicados `18090`, `8090`, `8092`, `5432`, `6543`, `8000`, `1935` y `8081`; hay también un proyecto Traefik cuyos puertos no están desplegados en la captura. Se reservó **18091** para este paquete porque no aparece en esa lista. La captura no permite descartar otros procesos del host: verificar el puerto antes de implementar o cambiar `NATAN_HTTP_PORT` en Hostinger si estuviera ocupado.

```sh
ss -lnt '( sport = :18091 )'
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

- No se publican 80/443 ni puertos PostgreSQL/Supabase.
- El puerto 3000 es interno al contenedor; no ocupa el 3000 del host ni el 8090 del proyecto existente.
- Docker crea una red propia del proyecto y asigna sus direcciones. No se fija IP, subred, nombre global de contenedor ni red externa.
- `traefik.enable=false` evita que Traefik registre automáticamente este contenedor.
- No se montan datos de otros proyectos, no se restaura SQL automáticamente y no se crea otra base de datos.
- El contenedor tiene límites de 1 CPU, 512 MiB de memoria y 100 procesos. La construcción de la imagen usa recursos adicionales del host.
- Si el puerto ya está ocupado, Docker rechazará ese arranque; este paquete no detiene al servicio que lo ocupa.

La aplicación **sigue apuntando por defecto al Supabase original de los HTML**, no al Supabase del proyecto `natan-electronics` que aparece en la captura. Antes de usar el panel o habilitar integraciones, elegir el backend correcto y cargar sus credenciales. Un despliegue independiente de Docker no crea una copia independiente de los datos remotos. Para otra base, seguir la sección 3 y configurar también `FRONTEND_SUPABASE_*`.

### Alternativa por SSH

```sh
git clone https://github.com/merchandev/Natan.git /opt/natan-respaldo
cd /opt/natan-respaldo
cp .env.example .env
chmod 600 .env
nano .env
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
curl --fail http://127.0.0.1:18091/healthz
```

Completar las credenciales reales de Supabase, D3xD y BNC en las variables de Hostinger o en `.env` si se usa SSH. Están ausentes del respaldo original. Sin ellas, el servidor puede estar saludable pero las integraciones no están operativas. El servidor solo publica los archivos web previstos; los SQL, el respaldo y los helpers no son descargables por HTTP.

## 2. Recuperar la base y el contenido completo

Este paso recupera archivos locales. **No ejecuta SQL ni cambia producción.** Se necesita Node.js 24 en el equipo donde se vaya a descifrar; también puede hacerse en este PC y transferir el resultado por SSH.

Copiar la clave al VPS mediante un canal privado y guardarla fuera del clon, por ejemplo `/root/CLAVE-RESPALDO-NATAN.key.txt`, con permisos `600`. No pegarla en GitHub, en un issue ni en el historial de un comando.

```sh
cd /opt/natan-respaldo
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

El workflow **Desplegar en VPS Hostinger** es una alternativa al administrador Docker: usa SSH y se ejecuta manualmente desde Actions → Run workflow. Antes debe existir `/opt/natan-respaldo` en el VPS, con sus variables configuradas, y el usuario SSH debe poder actualizar esa carpeta y ejecutar Docker. Elegir un único método de administración para este proyecto; no mezclarlo con un clon diferente que hPanel gestione.

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
cd /opt/natan-respaldo
sh deploy/update.sh
```

## Verificaciones realizadas

- Imagen Docker construida con el lockfile original; `npm ci` informó cero vulnerabilidades.
- Pruebas HTTP del adaptador: páginas originales, rutas PHP, autenticación, lectura cruda de D3xD, bloqueo de archivos internos y configuración opcional del frontend.
- Comprobación de SHA-256 de los 61 archivos originales y sintaxis de 28 bloques/scripts JavaScript.
- Descifrado y comparación completa de los 2.327 archivos del respaldo.
- Restauración de esquema y datos en PostgreSQL 17 temporal con roles y función `auth.jwt()` simulados; coincidencia de cantidades. Esto no sustituye una prueba de Supabase Auth, Storage o RLS en producción.
- Las 2.008 referencias distintas a fotos de los JSON tienen archivo local; el respaldo conserva también las fotos no referenciadas.
- Prueba del Compose actual sin Caddy y sin `.env` obligatorio: aplicación saludable y HTTP 200 en tienda y panel. Una clave incorrecta rechazó la recuperación sin extraer archivos.

No se accedió al VPS, no se modificó el DNS ni la base actual y no se realizaron operaciones bancarias. Esta entrega prepara el repositorio; la implementación y sus variables se configuran en Hostinger.

Fuentes oficiales de referencia: [Docker en Hostinger](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/), [redes independientes en Compose](https://docs.docker.com/compose/how-tos/networking/), [Supabase autoalojado](https://supabase.com/docs/guides/self-hosting/docker), [restauración a Supabase autoalojado](https://supabase.com/docs/guides/self-hosting/restore-from-platform).
