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


## Página de fragmentos y código QR

- La página pública de poesía está disponible en `/poesia`.
- La tienda muestra un QR que lleva a esa página y se genera automáticamente en `/qr-poesia.svg`.
- El QR usa `BASE_URL` cuando está configurada; si no, usa el dominio de la solicitud.
- Al publicar cambios en Render, el QR apunta al dominio público configurado. Si cambia el dominio, revisá `BASE_URL`.
- La página contiene fragmentos breves de poemas y un enlace de regreso a los libros.
