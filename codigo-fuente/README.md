# Natan Electronics — Tienda online y panel administrativo

Código fuente de **natanelectronics.com**: tienda online, panel de administración e integraciones con el sistema administrativo D3xD / Gisin3 y con el Banco Nacional de Crédito (BNC).

Desarrollado por **Navi Dev · Navi Group**.

---

## Estructura

| Ruta | Qué es |
|---|---|
| `index.html` | Tienda online (catálogo, búsqueda, carrito, checkout, "Mi cuenta") |
| `admin.html` | Panel administrativo (productos, pedidos, clientes, ofertas, categorías, configuración, tasa BCV) |
| `estado.html` | Página de estado de las integraciones (`/estado`) |
| `manual.html` | Manual de uso del panel |
| `informe.html` | Informe de entrega de la primera etapa |
| `api/d3xd/` | API que consume el sistema D3xD (rutas `/api_d3xd/*.php`) |
| `api/bnc/` | Conexión con BNC (tasa BCV, validación de pagos, webhook de notificaciones) |
| `api/status.js` | Diagnóstico público de las integraciones (sin datos sensibles) |
| `supabase/esquema_completo.sql` | Esquema completo de la base de datos con permisos (RLS) |
| `supabase/rls_permisos_por_rol.sql` | Permisos por rol (admin / operador) |
| `vercel.json` | Rutas: traduce `/api_d3xd/*.php` a las funciones de `api/d3xd/` |
| `.github/workflows/update-bcv.yml` | Actualiza la tasa BCV oficial de lunes a viernes |
| `img/` | Imágenes por defecto de la portada |

## Tecnología

- **Frontend:** HTML + JavaScript + Tailwind (sin compilación).
- **Backend:** funciones serverless Node.js en **Vercel**.
- **Base de datos, autenticación y archivos:** **Supabase** (PostgreSQL).
- **Hosting y dominio:** Vercel, con despliegue automático desde GitHub (rama `main`).

## Puesta en marcha en una cuenta nueva

1. **Supabase:** crear un proyecto y ejecutar `supabase/esquema_completo.sql` en el SQL Editor. Crear el bucket público `natan-products` en Storage para las fotos.
2. **Administradores:** en Authentication crear los usuarios del panel y registrarlos en la tabla `natan_admins` con rol `admin` u `operador`. Desactivar el registro público ("Allow new users to sign up").
3. **Claves públicas:** en `index.html` y `admin.html` reemplazar `SUPABASE_URL` y `SUPABASE_KEY` (clave *anon*, es pública por diseño) por las del proyecto nuevo.
4. **Vercel:** importar el repositorio y cargar las variables de entorno de `.env.example` (todas como *Sensitive*, entorno Production).
5. **GitHub Actions:** en el repositorio, agregar el secreto `SUPABASE_ANON_KEY` y ajustar la URL de Supabase en `update-bcv.yml`.
6. **Dominio:** apuntar `natanelectronics.com` a Vercel.

## Integración con D3xD

En D3xD: *Tienda Virtual Mediante API → Configuración → Datos de Acceso*

- **URL API:** `https://natanelectronics.com/api_d3xd/`
- **Token:** el mismo valor de `D3XD_API_TOKEN`.
- **Moneda:** USD.

Funcionamiento:

- **Cada 10 minutos** D3xD envía precios y existencia (`actualizar_precios_stock.php`).
- **"Actualizar todos los productos"** crea o actualiza el catálogo completo (`productos.php` / `guardar_productos.php`).
- La tasa de cambio llega por `settings.php`; los precios en bolívares se convierten a USD con esa misma tasa, para que coincidan con la tienda física.
- Los productos se identifican por **código** (único en la base de datos). Las fotos se cargan desde el panel; D3xD no maneja fotos.
- Un producto con existencia 0 se muestra como **Agotado** y no se puede comprar.
- El catálogo es tolerante a datos con formato irregular enviados por el sistema (comillas sin escapar, comas decimales).

Ver `SETUP_D3XD.md` para la configuración paso a paso.

## Integración con BNC

- Consultas salientes (tasa BCV, validación de pagos) funcionan desde el servidor.
- Las notificaciones de pago (webhook SNP) se reciben en:
  - `https://bnc-webhook.natanelectronics.com/api/bnc/webhook` (producción)
  - `https://bnc-webhook.natanelectronics.com/api/bnc/webhook-dev` (pruebas)

  Ese subdominio pasa por un servidor con **IP fija** porque BNC exige una IP fija para su lista blanca. El servidor solo reenvía esas dos rutas a la web. La clave `x-api-key` que manda BNC debe coincidir con `BNC_WEBHOOK_API_KEY`.
- La WorkingKey de BNC se guarda **cifrada** (AES-256-GCM) con `BNC_MASTER_KEY`.
- Los envíos de dinero (P2P / C2P) están **desactivados** por seguridad. Antes de activarlos hay que agregar autorización por operador, idempotencia y bitácora.

## Seguridad

- El panel usa usuarios con correo y contraseña, y permisos por rol (admin / operador) en la base de datos.
- El navegador solo conoce la clave pública de Supabase. Las claves de BNC y D3xD viven en variables de entorno del servidor.
- **Eliminar un producto lo desactiva**; no lo borra, para conservar fotos e historial.
- Nunca subir claves a este repositorio.
