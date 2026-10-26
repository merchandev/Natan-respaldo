# Integración D3xD ↔ Natan Electronics — Listo para conectar

## ✅ De nuestro lado (Navi Dev) — completado y probado

- Los 7 endpoints que pide el manual de D3xD están en producción y probados uno por uno (crear, actualizar, no duplicar, desactivar, consultar pedidos, marcar pedido descargado).
- Comparamos productos por **código**, no por nombre — no se van a duplicar aunque D3xD cambie la descripción.
- "Eliminar" nunca borra de verdad — desactiva el producto o marca el pedido como descargado. No se pierde ninguna foto ni historial de ventas.
- Ya limpiamos 20 productos duplicados que habían quedado de una sincronización anterior (se conservó siempre la versión con foto).
- El checkout de la web ya guarda el producto exacto de cada pedido, para que D3xD pueda descontar inventario correctamente.

## 🔧 Lo que falta — configurar en D3xD (Carlos)

En el sistema D3xD: **Setup → Configuración → Módulos → Tienda Virtual Web → Tienda Virtual por API** → Guardar y Salir.

Luego: **Tienda Virtual Mediante API → Configuración → Datos de Acceso → Editar**

| Campo | Valor |
|---|---|
| URL API | `https://natanelectronics.com/api_d3xd/` |
| Token de Acceso | El valor de la variable `D3XD_API_TOKEN` en Vercel (Project → Settings → Environment Variables). No se escribe aquí: este archivo va al repositorio. |
| Moneda a usar en la Web | USD |

Clic en **Verificar Conexión** → debe decir conexión exitosa → **Guardar Cambios**.

## 🧪 Antes de activar todo: hagan una prueba controlada

1. Sincronicen 2-3 productos nomás desde D3xD (no todo el catálogo de una vez).
2. Revisen en la web que el precio, nombre y categoría lleguen correctos.
3. Hagan un pedido de prueba en la web y verifiquen que aparezca del lado de D3xD al "Actualizar Pedidos".
4. Si todo cuadra, ya pueden activar la sincronización automática completa (el "Actualizador de Tienda Virtual" con intervalo, ej. cada 5 min).

## ⚠️ Cosas que D3xD NO puede hacer (para que no las esperen)

- **Fotos de producto**: D3xD no maneja fotos — eso siempre se sube a mano desde el panel admin de Natan, como hasta ahora.
- **Stock por sede**: el manual de D3xD no separa Maturín de Temblador en un solo campo de existencia — todo lo que llegue se registra como stock de Maturín. Si necesitan las dos sedes separadas, hay que preguntarle a soporte de D3xD si existe otro campo para eso antes de depender de esto.
- **Dirección de entrega**: el checkout de la web no pide dirección, así que ese campo le va a llegar vacío a D3xD.

## 📞 Si algo falla

Revisar primero:
1. ¿El token en D3xD es exactamente el de la tabla de arriba (sin espacios)?
2. ¿La URL termina en `/api_d3xd/` con la barra al final?
3. Si el error es de conexión, probar el botón "Verificar Conexión" — si falla ahí, es de configuración en D3xD, no del servidor.

Cualquier cosa, escribir a David.
