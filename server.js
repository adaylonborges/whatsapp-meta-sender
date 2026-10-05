const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Histórico de disparos e webhooks em memória (ideal para testes)
const logs = [];

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
    const errorDetails = data.error?.error_user_msg 
      || data.error?.message 
      || JSON.stringify(data);
    const fbTraceId = data.error?.fbtrace_id ? ` (Trace: ${data.error.fbtrace_id})` : '';
    throw new Error(`${errorDetails}${fbTraceId}`);
  }
  return data;
}

// Utilitário de formatação de número (remove caracteres não numéricos)
function cleanPhoneNumber(phone) {
  return phone.replace(/\D/g, '');
}

// 1. Rota de Configuração / Status
app.get('/api/config', (req, res) => {
  res.json({
    hasPhoneNumberId: !!process.env.META_PHONE_NUMBER_ID,
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
    hasAccessToken: !!process.env.META_ACCESS_TOKEN,
    accessToken: process.env.META_ACCESS_TOKEN || '',
    webhookVerifyToken: process.env.WEBHOOK_VERIFY_TOKEN || 'meu_token_secreto_webhook_123'
  });
});


// 2. Disparo Individual (Transacional)
app.post('/api/send-single', async (req, res) => {
  try {
    const {
      phoneNumberId = process.env.META_PHONE_NUMBER_ID,
      accessToken = process.env.META_ACCESS_TOKEN,
      recipient,
      type, // 'template' ou 'text'
      templateName,
      templateLang = 'pt_BR',
      templateParams = [],
      textMessage
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

      if (templateParams && templateParams.length > 0) {
        payload.template.components = [
          {
            type: 'body',
            parameters: templateParams.map(param => ({ type: 'text', text: String(param) }))
          }
        ];
      }
    } else {
      if (!textMessage) {
        return res.status(400).json({ success: false, error: 'Texto da mensagem é obrigatório.' });
      }
      payload.type = 'text';
      payload.text = { body: textMessage };
    }

    const metaResponse = await sendToMetaWhatsApp({ phoneNumberId, accessToken, payload });
    
    addLog('send_single', {
      recipient: cleanPhone,
      type,
      template: templateName || null,
      metaResponse
    });

    res.json({ success: true, metaResponse });
  } catch (error) {
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
      recipients = [], // Array de strings ou linhas
      templateName,
      templateLang = 'pt_BR',
      templateParams = [],
      textMessage,
      type = 'template',
      delaySeconds = 1 // Intervalo entre mensagens para evitar bloqueio
    } = req.body;

    if (!phoneNumberId || !accessToken) {
      return res.status(400).json({ success: false, error: 'Phone Number ID e Access Token são obrigatórios.' });
    }

    if (!recipients || recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum destinatário informado.' });
    }

    // Normalizar lista de contatos (pode ser array de strings ou array de objetos { phone, params, text })
    const normalizedRecipients = recipients.map(item => {
      if (typeof item === 'string') {
        return { phone: cleanPhoneNumber(item), params: templateParams, text: textMessage };
      }
      return {
        phone: cleanPhoneNumber(item.phone || ''),
        params: item.params && item.params.length > 0 ? item.params : templateParams,
        text: item.text || textMessage
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
        const currentParams = contact.params || [];
        if (currentParams.length > 0) {
          payload.template.components = [
            {
              type: 'body',
              parameters: currentParams.map(param => ({ type: 'text', text: String(param) }))
            }
          ];
        }
      } else {
        payload.type = 'text';
        payload.text = { body: contact.text || textMessage };
      }

      try {
        const metaResponse = await sendToMetaWhatsApp({ phoneNumberId, accessToken, payload });
        results.push({ phone: contact.phone, status: 'success', metaResponse });
        addLog('send_batch', { phone: contact.phone, status: 'success', metaResponse });
      } catch (err) {
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
