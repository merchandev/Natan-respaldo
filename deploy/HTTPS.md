# Actualizar Natan y activar HTTPS desde la consola del VPS

Destino: `https://natanelectronics.com` y `https://www.natanelectronics.com`, con redirección al dominio principal. La aplicación de las capturas es **`natan-app-1`**, proyecto **`natan`**, puerto publicado **18091**. No se debe crear una segunda instancia ni reemplazar el proyecto separado `natan-electronics`.

El DNS A de ambos nombres se comprobó el 26 de octubre de 2026 y apunta a `72.62.86.94`; no aparecían registros AAAA. Los HTML y enlaces canónicos originales ya usan el dominio correcto. El 404 mostrado es compatible con la falta de ruta en Traefik: el Compose básico tenía `traefik.enable=false`.

## Comandos completos: ejecutar como root

El bloque instala únicamente las utilidades que falten, obtiene todo el código y ejecuta la actualización. No lleva contraseñas ni claves privadas. El clon puede ocupar unos 250 MB debido al respaldo cifrado.

```bash
bash <<'NATAN'
set -euo pipefail
if ! command -v git >/dev/null || ! command -v python3 >/dev/null || ! python3 -c 'import yaml' 2>/dev/null; then
  apt-get update
  apt-get install -y --no-upgrade git python3 python3-yaml
fi
docker compose version
if [ -d /opt/natan-https/.git ]; then
  git -C /opt/natan-https pull --ff-only origin main
else
  git clone --branch main https://github.com/merchandev/Natan.git /opt/natan-https
fi
cd /opt/natan-https
python3 deploy/enable_https.py --app-container natan-app-1 --apply
NATAN
```

Para inspeccionar primero sin construir ni recrear contenedores:

```bash
cd /opt/natan-https
python3 deploy/enable_https.py --app-container natan-app-1
```

## Qué hace el script

1. Verifica que el contenedor indicado sea el servicio `app` del proyecto `natan`, `natan-respaldo` u `old-natan`. Rechaza `natan-electronics` y contenedores con volúmenes no previstos.
2. Localiza el Traefik en ejecución y lee su configuración estática por argumentos, variables o archivos estándar. Identifica los entrypoints de 80/443, el emisor ACME y la red real. **No supone que la red se llame `traefik-net`.**
3. Comprueba que exista un challenge ACME, un almacén de certificados persistente y escribible, DNS hacia el VPS y ausencia de otras rutas Docker para los mismos hosts. No modifica la configuración de Traefik ni su almacén de certificados.
4. Guarda en `.deploy-private/FECHA/` la inspección del contenedor y los Compose de actualización/reversión, con permisos privados. Estos archivos contienen credenciales y están excluidos de Git y Docker build. No compartirlos.
5. Conserva todas las variables del contenedor actual, su nombre, proyecto, puerto publicado y redes existentes. Añade solo la conexión a la red del proxy y las etiquetas del dominio. Los valores que contienen `$` se preservan literalmente.
6. Etiqueta la imagen anterior para volver atrás y **construye la imagen nueva antes de recrear nada**. Si falla la construcción, la aplicación actual sigue funcionando.
7. Ejecuta `docker compose up` solamente para `app`, sin `down`, sin eliminar volúmenes y sin reiniciar Traefik, PostgreSQL ni otros proyectos. Habrá una breve interrupción de Natan durante su recreación. Si la app nueva no queda saludable, intenta recuperar automáticamente la imagen anterior.
8. Comprueba que los otros contenedores observados no hayan reiniciado y espera hasta 180 segundos por HTTPS válido en ambos nombres. No usa `curl -k` ni desactiva la validación de certificados.

Traefik realiza la solicitud y renovación del certificado con el resolver existente; **no se instala otro Nginx, Caddy ni Certbot**, y Natan no intenta ocupar 80/443. Los certificados permanecen en el almacenamiento que ya usa Traefik.

El script no importa SQL ni cambia Supabase. Mantiene las credenciales y datos configurados en la aplicación existente. La copia cifrada continúa en el repositorio.

## Si hay varios proxies o redes

Si Traefik usa `network_mode: host`, el script conserva la red bridge local de la app y comprueba desde el servidor su `/healthz` interno antes de cambiarla. No conecta Traefik a otra red ni cambia su configuración. Si la app tiene varias redes, seleccionar una existente con `--traefik-network`. Este modo corrige el aviso vacío «Traefik tiene varias redes» de la versión anterior.

El script se detiene antes de recrear la aplicación e indica los candidatos. Volver a ejecutarlo seleccionando los nombres reales, por ejemplo:

```bash
python3 deploy/enable_https.py --app-container natan-app-1 \
  --traefik-container NOMBRE_REAL_DEL_CONTENEDOR \
  --traefik-network NOMBRE_REAL_DE_LA_RED --apply
```

También acepta `--http-entrypoint`, `--https-entrypoint` y `--cert-resolver`. Los preferidos son `web`, `websecure` y `letsencrypt`, como en las capturas; si la configuración identifica una única alternativa válida, se detecta automáticamente.

Si no puede confirmar el proveedor Docker, el emisor ACME, los entrypoints o su almacenamiento, **no modifica el proxy compartido**. Ese prerrequisito debe corregirse en su configuración real, conservando las rutas y el almacenamiento de los demás proyectos. Las capturas no bastan para inventar esas opciones. Si ya hay una ruta para el dominio en otro contenedor, revisar esa asociación específica en vez de detener todo el proyecto anterior. Las rutas de un proveedor `file` no se pueden descubrir a partir de las etiquetas Docker: revisar también el dashboard si sigue respondiendo otro destino.

## Comprobar el resultado

```bash
docker ps --filter name=natan-app-1
curl --fail https://natanelectronics.com/healthz
curl -I https://natanelectronics.com/admin
curl -I https://www.natanelectronics.com/admin
curl -I http://natanelectronics.com/admin
```

Esperado: app saludable, `healthz` con `service: natan-vps`, panel HTTP 200 y redirección de www/HTTP a `https://natanelectronics.com`. Solo el mensaje **«HTTPS verificado con certificado válido...»** confirma el final de la comprobación automática.

Si la app queda saludable pero el certificado tarda o falla, el script devuelve error y deja la app operativa. Indica el nombre de Traefik para consultar:

```bash
docker logs --since 10m NOMBRE_REAL_DE_TRAEFIK
```

Revisar DNS/AAAA, CAA, challenge ACME, acceso externo a 80/443, límites de Let's Encrypt, resolver y conectividad de la red. No borrar `acme.json` ni detener otros proyectos para resolver un error SSL.

## Actualizaciones siguientes y reversión

El script recuerda la selección del proxy en `.deploy-private/active.json`. Para actualizar sin perder las etiquetas HTTPS:

```bash
cd /opt/natan-https
sh deploy/update.sh
```

El workflow manual de GitHub utiliza este directorio y exige esa configuración activa. No ejecutar el `compose.yaml` básico solo después de activar HTTPS, pues ese modo básico mantiene Traefik deshabilitado. Tampoco volver a implementar desde la definición antigua de hPanel: este clon pasa a administrar el servicio, conservando su nombre y proyecto. En hPanel puede seguir apareciendo la definición antigua hasta que se sincronice su configuración.

Al terminar, el script imprime una orden como:

```bash
sh /opt/natan-https/.deploy-private/FECHA/rollback.sh
```

Usar la ruta exacta impresa para recuperar la imagen/configuración anterior de la app. La reversión no borra certificados ni afecta los datos remotos.

## Uso manual del Compose HTTPS

`compose.https.yaml` es un complemento de `compose.yaml`, no un proyecto separado. Para instalaciones nuevas se combinan ambos archivos indicando `TRAEFIK_NETWORK`, `TRAEFIK_HTTP_ENTRYPOINT`, `TRAEFIK_HTTPS_ENTRYPOINT` y `TRAEFIK_CERT_RESOLVER`. Para la aplicación que ya está en el VPS, preferir el script anterior: conserva el proyecto `natan` y extrae sus variables actuales, evitando desplegar por accidente otro `natan-respaldo` o perder credenciales.

Supabase Auth debe tener Site URL `https://natanelectronics.com` y los retornos usados por el panel. D3xD debe llamar directamente a `https://natanelectronics.com/api_d3xd/` para no depender de una redirección de POST. El subdominio `bnc-webhook.natanelectronics.com` no se modifica con estas reglas.

Referencias oficiales: [etiquetas Docker de Traefik](https://doc.traefik.io/traefik/reference/routing-configuration/other-providers/docker/), [ACME y certificados](https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/).
