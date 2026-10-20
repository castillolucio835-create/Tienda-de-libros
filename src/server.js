import express from 'express';
import QRCode from 'qrcode';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const PRIVATE = path.join(ROOT, 'private');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(ROOT, 'public')));

app.get('/poesia', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'poesia.html'));
});

app.get('/qr-poesia.svg', async (req, res) => {
  try {
    const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
    const protocol = forwardedProto || req.protocol || 'https';
    const baseUrl = BASE_URL || `${protocol}://${req.get('host')}`;
    const svg = await QRCode.toString(`${baseUrl}/poesia`, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 420,
      color: { dark: '#17121d', light: '#ffffff' }
    });
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  } catch (error) {
    console.error('qr-poesia:', error);
    res.status(500).send('No se pudo generar el código QR.');
  }
});

const PORT = Number(process.env.PORT || 10000);
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || '';

const BOOKS = {
  antologia: {
    title: 'Antología Poética — Segunda Edición 2026',
    description: 'Antología poética de Lucio Castillo, segunda edición 2026.',
    price: 7000,
    file: 'antologia.pdf'
  },
  haikus: {
    title: 'Haikus — De otoño, invierno, primavera y verano',
    description: 'Colección de haikus de Lucio Castillo.',
    price: 5000,
    file: 'haikus.pdf'
  }
};

function requireConfig(res) {
  if (!MP_ACCESS_TOKEN || !BASE_URL) {
    res.status(500).json({ error: 'Falta configurar MP_ACCESS_TOKEN o BASE_URL en Render.' });
    return false;
  }
  return true;
}

function safeEqual(a, b) {
  const aa = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function makeToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', MP_ACCESS_TOKEN).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readToken(token) {
  if (!token || !MP_ACCESS_TOKEN) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', MP_ACCESS_TOKEN).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function mpFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(`Mercado Pago respondió ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

app.get('/api/books', (req, res) => {
  res.json(Object.entries(BOOKS).map(([id, b]) => ({ id, title: b.title, description: b.description, price: b.price })));
});

app.post('/api/create-checkout', async (req, res) => {
  if (!requireConfig(res)) return;
  const { bookId } = req.body || {};
  const book = BOOKS[bookId];
  if (!book) return res.status(400).json({ error: 'Libro no válido.' });

  const orderId = crypto.randomUUID();
  const externalReference = `${bookId}:${orderId}`;

  try {
    const preference = await mpFetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify({
        items: [{
          id: bookId,
          title: book.title,
          description: book.description,
          quantity: 1,
          currency_id: 'ARS',
          unit_price: book.price
        }],
        external_reference: externalReference,
        back_urls: {
          success: `${BASE_URL}/pago-exitoso`,
          failure: `${BASE_URL}/pago-fallido`,
          pending: `${BASE_URL}/pago-pendiente`
        },
        auto_return: 'approved',
        notification_url: `${BASE_URL}/api/webhook`
      })
    });

    res.json({ checkoutUrl: preference.init_point });
  } catch (err) {
    console.error('create-checkout:', err.data || err);
    res.status(502).json({ error: 'No se pudo crear el pago en Mercado Pago.' });
  }
});

async function getApprovedPayment(paymentId) {
  if (!/^\d+$/.test(String(paymentId))) return null;
  try {
    const payment = await mpFetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`);
    if (payment.status !== 'approved') return null;
    return payment;
  } catch (err) {
    console.error('payment lookup:', err.data || err);
    return null;
  }
}

function verifyPaymentForBook(payment, bookId) {
  const book = BOOKS[bookId];
  if (!payment || !book) return false;
  if (payment.status !== 'approved') return false;
  if (Number(payment.transaction_amount) !== Number(book.price)) return false;
  if (payment.currency_id && payment.currency_id !== 'ARS') return false;
  return typeof payment.external_reference === 'string' && payment.external_reference.startsWith(`${bookId}:`);
}

app.get('/pago-exitoso', async (req, res) => {
  const paymentId = String(req.query.payment_id || req.query.collection_id || '');
  const externalReference = String(req.query.external_reference || '');
  const bookId = externalReference.split(':')[0];
  const payment = await getApprovedPayment(paymentId);

  if (!verifyPaymentForBook(payment, bookId)) {
    return res.status(403).send(renderMessage('Pago todavía no verificado', 'No entregamos el libro hasta confirmar el pago directamente con Mercado Pago. Si acabás de pagar, esperá unos segundos y volvé a abrir el enlace de retorno.', '/'));
  }

  const token = makeToken({
    paymentId,
    bookId,
    exp: Date.now() + 30 * 60 * 1000
  });
  const downloadUrl = `/api/download/${encodeURIComponent(bookId)}?token=${encodeURIComponent(token)}`;
  res.send(renderMessage('¡Pago aprobado!', `Tu pago fue verificado correctamente. Ya podés descargar «${BOOKS[bookId].title}».`, downloadUrl, 'Descargar mi libro'));
});

app.get('/pago-pendiente', (req, res) => res.status(202).send(renderMessage('Pago pendiente', 'Mercado Pago todavía no confirmó el pago. El libro se habilita únicamente cuando el estado sea aprobado.', '/')));
app.get('/pago-fallido', (req, res) => res.status(400).send(renderMessage('Pago no aprobado', 'El pago no fue aprobado. No se habilitó ninguna descarga.', '/')));

app.get('/api/download/:bookId', async (req, res) => {
  const bookId = req.params.bookId;
  const token = readToken(req.query.token);
  if (!token || token.bookId !== bookId) return res.status(403).send('Enlace de descarga inválido o vencido.');

  const payment = await getApprovedPayment(token.paymentId);
  if (!verifyPaymentForBook(payment, bookId)) return res.status(403).send('El pago no pudo verificarse. La descarga fue bloqueada.');

  const book = BOOKS[bookId];
  const filePath = path.join(PRIVATE, book.file);
  if (!fs.existsSync(filePath)) return res.status(404).send('Archivo no encontrado.');

  res.download(filePath, book.file);
});

app.post('/api/webhook', async (req, res) => {
  // Validación HMAC de la firma de Mercado Pago cuando se configura MP_WEBHOOK_SECRET.
  // El webhook es una notificación adicional: la descarga siempre vuelve a consultar el pago.
  if (WEBHOOK_SECRET) {
    const xSignature = req.get('x-signature') || '';
    const xRequestId = req.get('x-request-id') || '';
    const dataId = String(req.query['data.id'] || req.body?.data?.id || '').toLowerCase();
    let ts = '';
    let v1 = '';
    for (const part of xSignature.split(',')) {
      const [key, ...rest] = part.split('=');
      const value = rest.join('=');
      if (key?.trim() === 'ts') ts = value?.trim() || '';
      if (key?.trim() === 'v1') v1 = value?.trim() || '';
    }
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(manifest).digest('hex');
    if (!v1 || !safeEqual(v1, expected)) return res.sendStatus(401);
  }

  const paymentId = req.body?.data?.id || req.query['data.id'];
  if (paymentId) {
    const payment = await getApprovedPayment(String(paymentId));
    if (payment?.status === 'approved') console.log(`Pago aprobado recibido por webhook: ${paymentId}`);
  }
  res.sendStatus(200);
});

app.get('/health', (req, res) => res.json({ ok: true }));

function renderMessage(title, message, href, buttonText = 'Volver a la tienda') {
  const button = href ? `<a class="button" href="${href}">${buttonText}</a>` : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/styles.css"></head><body><main class="message"><div class="brand">Lucio Castillo</div><h1>${title}</h1><p>${message}</p>${button}</main></body></html>`;
}

app.listen(PORT, () => console.log(`Tienda escuchando en puerto ${PORT}`));
