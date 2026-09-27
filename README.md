# Tienda de libros — Lucio Castillo

Tienda digital para vender los dos PDFs mediante Mercado Pago Checkout Pro y entregar el archivo solo después de verificar un pago aprobado.

## Productos
- Antología Poética — Segunda Edición 2026: $7.000 ARS
- Haikus: $5.000 ARS

## Variables de entorno en Render
- `MP_ACCESS_TOKEN`: Access Token de producción de Mercado Pago.
- `BASE_URL`: URL pública de tu servicio Render, por ejemplo `https://tu-tienda.onrender.com`.
- `MP_WEBHOOK_SECRET`: opcional; secreto de Webhooks de Mercado Pago.

## Deploy en Render
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Añadir las variables de entorno anteriores.

## Importante
Los PDFs están en `private/` y no se sirven mediante `express.static`. El endpoint de descarga vuelve a consultar el pago en Mercado Pago y exige estado `approved`, monto correcto, moneda ARS y referencia del producto.

El webhook es una notificación adicional; la entrega no depende solamente del webhook.
