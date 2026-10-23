const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const multer = require('multer');
const db = require('./db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 } // 16MB max
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Histórico de disparos inicializado do banco de dados SQLite
const logs = [];

// Carrega últimos disparos do SQLite na inicialização
try {
  const initialLogs = db.getRecentDispatches(50);
  initialLogs.forEach(d => {
    logs.push({
      id: d.id,
      timestamp: new Date(d.created_at).toLocaleTimeString('pt-BR'),
      type: d.type === 'batch' ? 'send_batch' : 'send_single',
      details: {
        recipient: d.recipient,
        template: d.template,
        status: d.status,
        wamid: d.wamid,
        error: d.error
      }
    });
  });
} catch (e) {
  console.warn('Erro ao carregar histórico inicial do SQLite:', e.message);
}

function addLog(type, details) {
  const logEntry = {
    id: Date.now() + Math.random().toString(36).substr(2, 5),
    timestamp: new Date().toLocaleTimeString('pt-BR'),
    type, // 'send_single', 'send_batch', 'webhook_event', 'error'
    details
  };
  logs.unshift(logEntry);
  if (logs.length > 200) logs.pop(); // Limite em memória
  return logEntry;
}

// Utilitário para chamada direta à Meta Graph API
async function sendToMetaWhatsApp({ phoneNumberId, accessToken, payload }) {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    const errorMsg = data.error?.message || 'Erro desconhecido na Meta API';
    const detailMsg = data.error?.error_data?.details ? `: ${data.error.error_data.details}` : '';
    const userMsg = data.error?.error_user_msg ? ` (${data.error.error_user_msg})` : '';
    const fbTraceId = data.error?.fbtrace_id ? ` [Trace: ${data.error.fbtrace_id}]` : '';
    throw new Error(`${errorMsg}${detailMsg}${userMsg}${fbTraceId}`);
  }
  return data;
}

// Utilitário inteligente de formatação de número de telefone (Item 6)
function cleanPhoneNumber(phone) {
  let cleaned = String(phone || '').replace(/\D/g, '');
  // Adiciona DDI 55 se o número tiver 10 ou 11 dígitos (DDD + número)
  if ((cleaned.length === 10 || cleaned.length === 11) && !cleaned.startsWith('55')) {
    cleaned = '55' + cleaned;
  }
  return cleaned;
}

function validateBrazilianPhone(phone) {
  const cleaned = cleanPhoneNumber(phone);
  if (!cleaned || cleaned.length < 12 || cleaned.length > 13) {
    return { valid: false, phone: cleaned, reason: 'Comprimento inválido (esperado 12 ou 13 dígitos com DDI 55)' };
  }
  if (!cleaned.startsWith('55')) {
    return { valid: false, phone: cleaned, reason: 'DDI inválido (esperado 55 para Brasil)' };
  }
  const ddd = parseInt(cleaned.substring(2, 4), 10);
  if (isNaN(ddd) || ddd < 11 || ddd > 99) {
    return { valid: false, phone: cleaned, reason: `DDD ${ddd} inválido` };
  }
  return { valid: true, phone: cleaned };
}

// 1. Rota de Configuração / Status
app.get('/api/config', (req, res) => {
  res.json({
    hasPhoneNumberId: !!process.env.META_PHONE_NUMBER_ID,
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
    hasAccessToken: !!process.env.META_ACCESS_TOKEN,
    accessToken: process.env.META_ACCESS_TOKEN || '',
    hasWabaId: !!process.env.META_WABA_ID,
    wabaId: process.env.META_WABA_ID || '1024545617120343',
    webhookVerifyToken: process.env.WEBHOOK_VERIFY_TOKEN || 'meu_token_secreto_webhook_123'
  });
});

// 1.1 Rota para Listar Templates Aprovados da WABA
app.get('/api/templates', async (req, res) => {
  try {
    const accessToken = req.query.accessToken || process.env.META_ACCESS_TOKEN;
    const wabaId = req.query.wabaId || process.env.META_WABA_ID || '1024545617120343';

    if (!accessToken || !wabaId) {
      return res.status(400).json({ success: false, error: 'Access Token e WABA ID são obrigatórios.' });
    }

    const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=100`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Erro ao carregar templates da Meta');
    }

    const templates = (data.data || []).map(t => {
      const headerComponent = t.components?.find(c => c.type === 'HEADER');
      const bodyComponent = t.components?.find(c => c.type === 'BODY');
      const buttonComponent = t.components?.find(c => c.type === 'BUTTONS');

      const headerFormat = headerComponent?.format || null;
      const requiresImage = headerFormat === 'IMAGE';
      const defaultImageUrl = headerComponent?.example?.header_handle?.[0] || null;
      
      const knownMediaIds = {
        '20261023_wpp_20off_evo_img_pt': '1475671457712153',
        '20261023_wpp_20off_vomero_img': '3393562647512994'
      };
      const defaultMediaId = knownMediaIds[t.name] || null;

      const bodyText = bodyComponent?.text || '';
      const variableMatches = bodyText.match(/\{\{\d+\}\}/g) || [];
      const variableCount = [...new Set(variableMatches)].length;

      return {
        name: t.name,
        status: t.status,
        language: t.language,
        category: t.category,
        requiresImage,
        headerFormat,
        defaultImageUrl,
        defaultMediaId,
        variableCount,
        hasButtons: !!buttonComponent,
        buttons: buttonComponent?.buttons || [],
        bodyText: bodyText,
        previewText: bodyText
      };
    });

    res.json({ success: true, templates });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// 1.2 Rota de Upload Direto de Mídia na Meta (Item 1)
app.post('/api/upload-media', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado.' });
    }

    const phoneNumberId = req.body.phoneNumberId || process.env.META_PHONE_NUMBER_ID;
    const accessToken = req.body.accessToken || process.env.META_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
      return res.status(400).json({ success: false, error: 'Credenciais da Meta (Phone Number ID ou Access Token) não configuradas.' });
    }

    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    formData.append('file', blob, req.file.originalname);
    formData.append('type', req.file.mimetype);
    formData.append('messaging_product', 'whatsapp');

    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      body: formData
    });

    const data = await metaRes.json();
    if (!metaRes.ok) {
      throw new Error(data.error?.message || 'Falha no upload para a API da Meta');
    }

    const savedMedia = db.saveMedia({
      mediaId: data.id,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size
    });

    res.json({
      success: true,
      mediaId: data.id,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 1.3 Rota para Listar Mídias do Cofre
app.get('/api/media', (req, res) => {
  try {
    const list = db.getMediaList();
    res.json({ success: true, media: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1.4 Rota de Métricas e Funil em Tempo Real (Item 3)
app.get('/api/metrics', (req, res) => {
  try {
    const metrics = db.getMetrics();
    res.json({ success: true, metrics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1.5 Rota de Exportação do Relatório CSV (Item 4)
app.get('/api/export-csv', (req, res) => {
  try {
    const dispatches = db.getRecentDispatches(2000);
    let csv = '\uFEFFID,Tipo,Telefone,Template,Status,WAMID,Erro,Data/Hora\n';
    dispatches.forEach(d => {
      const line = [
        `"${d.id || ''}"`,
        `"${d.type || ''}"`,
        `"${d.recipient || ''}"`,
        `"${d.template || ''}"`,
        `"${d.status || ''}"`,
        `"${d.wamid || ''}"`,
        `"${(d.error || '').replace(/"/g, '""')}"`,
        `"${d.created_at || ''}"`
      ].join(',');
      csv += line + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio_disparos_${Date.now()}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).send('Erro ao exportar CSV: ' + err.message);
  }
});

// 1.6 Rota de Higienização e Validação de Contatos (Item 6)
app.post('/api/sanitize-contacts', (req, res) => {
  try {
    const { contacts = [] } = req.body;
    const valid = [];
    const duplicates = [];
    const invalid = [];
    const seen = new Set();

    contacts.forEach((item, index) => {
      const rawPhone = typeof item === 'string' ? item : item.phone;
      const validation = validateBrazilianPhone(rawPhone);

      if (!validation.valid) {
        invalid.push({ index: index + 1, raw: rawPhone, reason: validation.reason });
        return;
      }

      const cleanPhone = validation.phone;
      if (seen.has(cleanPhone)) {
        duplicates.push({ index: index + 1, phone: cleanPhone });
        return;
      }

      seen.add(cleanPhone);
      valid.push({
        ...(typeof item === 'object' ? item : {}),
        phone: cleanPhone
      });
    });

    res.json({
      success: true,
      stats: {
        total: contacts.length,
        validCount: valid.length,
        duplicateCount: duplicates.length,
        invalidCount: invalid.length
      },
      valid,
      duplicates,
      invalid
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Disparo Individual (Transacional)
app.post('/api/send-single', async (req, res) => {
  try {
    const {
      phoneNumberId = process.env.META_PHONE_NUMBER_ID,
      accessToken = process.env.META_ACCESS_TOKEN,
      recipient,
      type, // 'template', 'text' ou 'image'
      templateName,
      templateLang = 'pt_BR',
      templateParams = [],
      headerImageUrl,
      textMessage,
      imageUrl,
      imageCaption
    } = req.body;

    if (!phoneNumberId || !accessToken) {
      return res.status(400).json({ success: false, error: 'Phone Number ID e Access Token são obrigatórios.' });
    }

    const cleanPhone = cleanPhoneNumber(recipient || '');
    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({ success: false, error: 'Número de telefone inválido. Formato esperado: DDI + DDD + Número (ex: 5511999998888).' });
    }

    let payload = {
      messaging_product: 'whatsapp',
      to: cleanPhone
    };

    if (type === 'template') {
      if (!templateName) {
        return res.status(400).json({ success: false, error: 'Nome do template é obrigatório.' });
      }
      payload.type = 'template';
      payload.template = {
        name: templateName,
        language: { code: templateLang }
      };

      const components = [];

      // Imagem no Cabeçalho (Header) do Template (se fornecido)
      if (headerImageUrl && typeof headerImageUrl === 'string' && headerImageUrl.trim().length > 0) {
        const imgVal = headerImageUrl.trim();
        const isMediaId = /^\d+$/.test(imgVal);
        components.push({
          type: 'header',
          parameters: [
            {
              type: 'image',
              image: isMediaId ? { id: imgVal } : { link: imgVal }
            }
          ]
        });
      }

      // Parâmetros das variáveis do corpo (Body) - apenas valores não vazios
      const validParams = (templateParams || [])
        .map(param => String(param !== null && param !== undefined ? param : '').trim())
        .filter(text => text.length > 0);

      if (validParams.length > 0) {
        components.push({
          type: 'body',
          parameters: validParams.map(text => ({ type: 'text', text }))
        });
      }

      if (components.length > 0) {
        payload.template.components = components;
      }
    } else if (type === 'image') {
      // Envio de Imagem Direta com legenda opcional (janela de 24h)
      if (!imageUrl || !imageUrl.trim()) {
        return res.status(400).json({ success: false, error: 'URL da imagem é obrigatória.' });
      }
      payload.type = 'image';
      payload.image = {
        link: imageUrl.trim()
      };
      if (imageCaption && imageCaption.trim()) {
        payload.image.caption = imageCaption.trim();
      }
    } else {
      if (!textMessage) {
        return res.status(400).json({ success: false, error: 'Texto da mensagem é obrigatório.' });
      }
      payload.type = 'text';
      payload.text = { body: textMessage };
    }

    const metaResponse = await sendToMetaWhatsApp({ phoneNumberId, accessToken, payload });
    const wamid = metaResponse.messages?.[0]?.id || null;
    
    // Grava no SQLite e na memória
    db.saveDispatch({
      id: Date.now() + Math.random().toString(36).substr(2, 5),
      type: 'single',
      recipient: cleanPhone,
      template: templateName || null,
      status: 'accepted',
      wamid,
      payload
    });

    addLog('send_single', {
      recipient: cleanPhone,
      type,
      template: templateName || null,
      metaResponse
    });

    res.json({ success: true, metaResponse });
  } catch (error) {
    db.saveDispatch({
      id: Date.now() + Math.random().toString(36).substr(2, 5),
      type: 'single',
      recipient: req.body?.recipient || 'desconhecido',
      template: req.body?.templateName || null,
      status: 'failed',
      error: error.message,
      payload: req.body
    });

    addLog('error', {
      action: 'send-single',
      recipient: req.body?.recipient,
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Disparo em Lote (Em Massa)
app.post('/api/send-batch', async (req, res) => {
  try {
    const {
      phoneNumberId = process.env.META_PHONE_NUMBER_ID,
      accessToken = process.env.META_ACCESS_TOKEN,
      recipients = [], // Array de strings ou objetos
      templateName,
      templateLang = 'pt_BR',
      templateParams = [],
      headerImageUrl,
      textMessage,
      imageUrl,
      imageCaption,
      type = 'template',
      delaySeconds = 1 // Intervalo entre mensagens para evitar bloqueio
    } = req.body;

    if (!phoneNumberId || !accessToken) {
      return res.status(400).json({ success: false, error: 'Phone Number ID e Access Token são obrigatórios.' });
    }

    if (!recipients || recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum destinatário informado.' });
    }

    // Normalizar lista de contatos (pode ser array de strings ou array de objetos { phone, params, text, headerImageUrl, imageUrl, imageCaption })
    const normalizedRecipients = recipients.map(item => {
      if (typeof item === 'string') {
        return {
          phone: cleanPhoneNumber(item),
          params: templateParams,
          headerImageUrl: headerImageUrl || null,
          text: textMessage,
          imageUrl: imageUrl || null,
          imageCaption: imageCaption || null
        };
      }
      return {
        phone: cleanPhoneNumber(item.phone || ''),
        params: item.params && item.params.length > 0 ? item.params : templateParams,
        headerImageUrl: item.headerImageUrl || headerImageUrl || null,
        text: item.text || textMessage,
        imageUrl: item.imageUrl || imageUrl || null,
        imageCaption: item.imageCaption || imageCaption || null
      };
    }).filter(item => item.phone && item.phone.length >= 10);

    if (normalizedRecipients.length === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum número válido encontrado na lista.' });
    }

    // Processar envios de forma sequencial com delay
    const results = [];
    
    for (let i = 0; i < normalizedRecipients.length; i++) {
      const contact = normalizedRecipients[i];
      let payload = {
        messaging_product: 'whatsapp',
        to: contact.phone
      };

      if (type === 'template') {
        payload.type = 'template';
        payload.template = {
          name: templateName,
          language: { code: templateLang }
        };

        const components = [];
        const currentHeaderImg = contact.headerImageUrl || headerImageUrl;
        if (currentHeaderImg && String(currentHeaderImg).trim().length > 0) {
          const imgVal = String(currentHeaderImg).trim();
          const isMediaId = /^\d+$/.test(imgVal);
          components.push({
            type: 'header',
            parameters: [
              {
                type: 'image',
                image: isMediaId ? { id: imgVal } : { link: imgVal }
              }
            ]
          });
        }

        // Parâmetros das variáveis do corpo (Body) - apenas valores não vazios
        const validParams = (contact.params || [])
          .map(param => String(param !== null && param !== undefined ? param : '').trim())
          .filter(text => text.length > 0);

        if (validParams.length > 0) {
          components.push({
            type: 'body',
            parameters: validParams.map(text => ({ type: 'text', text }))
          });
        }

        if (components.length > 0) {
          payload.template.components = components;
        }
      } else if (type === 'image') {
        const currentImg = contact.imageUrl || imageUrl;
        if (!currentImg || !String(currentImg).trim()) {
          results.push({ phone: contact.phone, status: 'failed', error: 'URL da imagem não informada' });
          continue;
        }
        payload.type = 'image';
        payload.image = { link: String(currentImg).trim() };
        const currentCaption = contact.imageCaption || imageCaption;
        if (currentCaption && String(currentCaption).trim()) {
          payload.image.caption = String(currentCaption).trim();
        }
      } else {
        payload.type = 'text';
        payload.text = { body: contact.text || textMessage };
      }

      try {
        const metaResponse = await sendToMetaWhatsApp({ phoneNumberId, accessToken, payload });
        const wamid = metaResponse.messages?.[0]?.id || null;

        db.saveDispatch({
          id: Date.now() + Math.random().toString(36).substr(2, 5),
          type: 'batch',
          recipient: contact.phone,
          template: templateName || null,
          status: 'accepted',
          wamid,
          payload
        });

        results.push({ phone: contact.phone, status: 'success', metaResponse });
        addLog('send_batch', { phone: contact.phone, status: 'success', metaResponse });
      } catch (err) {
        db.saveDispatch({
          id: Date.now() + Math.random().toString(36).substr(2, 5),
          type: 'batch',
          recipient: contact.phone,
          template: templateName || null,
          status: 'failed',
          error: err.message,
          payload
        });

        results.push({ phone: contact.phone, status: 'failed', error: err.message });
        addLog('send_batch', { phone: contact.phone, status: 'failed', error: err.message });
      }

      // Delay entre disparos
      if (delaySeconds > 0 && i < normalizedRecipients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      }
    }

    res.json({
      success: true,
      total: normalizedRecipients.length,
      successful: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
      details: results
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Endpoint Webhook: Verificação da Meta (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN || 'meu_token_secreto_webhook_123';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Webhook verificado com sucesso pela Meta!');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 5. Endpoint Webhook: Recebimento de Eventos (POST)
app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    const entries = body.entry || [];
    entries.forEach(entry => {
      const changes = entry.changes || [];
      changes.forEach(change => {
        const value = change.value;
        // Status de entrega (sent, delivered, read, failed)
        if (value && value.statuses) {
          value.statuses.forEach(status => {
            const errDetails = status.errors ? JSON.stringify(status.errors) : null;
            db.saveWebhookEvent({
              id: 'wh_' + Date.now() + Math.random().toString(36).substr(2, 4),
              event_type: 'status',
              recipient_id: status.recipient_id,
              wamid: status.id,
              status: status.status,
              errors: errDetails,
              raw_payload: status
            });

            addLog('webhook_status', {
              recipient_id: status.recipient_id,
              status: status.status,
              id: status.id,
              errors: status.errors || null
            });
          });
        }
        // Mensagens recebidas
        if (value && value.messages) {
          value.messages.forEach(msg => {
            addLog('webhook_incoming_message', {
              from: msg.from,
              type: msg.type,
              text: msg.text?.body || '[Mídia ou outro tipo]',
              id: msg.id
            });
          });
        }
      });
    });
    return res.status(200).send('EVENT_RECEIVED');
  }
  res.sendStatus(404);
});

// 6. Rota para recuperar logs em tempo real
app.get('/api/logs', (req, res) => {
  res.json({ logs });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Servidor WhatsApp Meta Sender rodando na porta ${PORT}`);
  console.log(`👉 Acesse no navegador: http://localhost:${PORT}`);
  console.log(`👉 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`======================================================\n`);
});
