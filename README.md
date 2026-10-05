# 📱 WhatsApp Meta Sender (Cloud API)

Solução minimalista e pronta para produção/testes para disparo de mensagens via **WhatsApp Cloud API oficial da Meta**.
Desenvolvida com **Node.js + Express** e um **Frontend moderno e intuitivo (Tailwind CSS)**.

Ideal para compartilhar com a equipe e evoluir via **Claude**, **Cursor** ou qualquer IA/desenvolvedor.

---

## 📑 Índice
1. [Visão Geral e Arquitetura](#-visão-geral-e-arquitetura)
2. [Estrutura de Arquivos](#-estrutura-de-arquivos)
3. [Pré-requisitos](#-pré-requisitos)
4. [Instalação e Execução](#-instalação-e-execução)
5. [Como Funciona a Integração com a Meta](#-como-funciona-a-integração-com-a-meta)
6. [Regras de Negócio do WhatsApp (Muito Importante)](#-regras-de-negócio-do-whatsapp-muito-importante)
7. [Endpoints da API Backend](#-endpoints-da-api-backend)
8. [Configuração do Webhook (Status de Leitura/Entrega)](#-configuração-do-webhook)
9. [Guia de Evolução com IA (Prompts recomendados para o Claude)](#-guia-de-evolução-com-ia-claude)

---

## 🏛 Visão Geral e Arquitetura

O projeto resolve o problema de enviar notificações transacionais e mensagens em lote diretamente pela infraestrutura da Meta (sem precisar de celular conectado via QR Code e sem risco de banimento de chip por ferramentas não oficiais).

```
[ Navegador / Frontend ]
          │
          ▼  (HTTP REST)
[ Backend Node.js / Express ]
    │                      │
    ▼ (POST Mensagens)     ▲ (Webhooks: Entrega / Respostas)
[ Meta Graph API Cloud ] ──┘
    │
    ▼
[ Dispositivo WhatsApp do Cliente ]
```

---

## 📁 Estrutura de Arquivos

```
whatsapp-meta-sender/
├── .env                  # Credenciais ativas (Phone Number ID e Access Token)
├── .env.example          # Modelo de variáveis de ambiente
├── package.json          # Dependências do projeto (express, dotenv, cors)
├── server.js             # Backend: rotas de disparo, webhook e chamadas Meta
├── public/
│   └── index.html        # Frontend: Dashboard com TailwindCSS e abas de disparo
└── README.md             # Esta documentação completa
```

---

## ⚙️ Pré-requisitos

1. **Node.js** (versão 18 ou superior instalada):
   - Baixe em: [nodejs.org](https://nodejs.org/) (versão LTS recomendada).
   - Para verificar no terminal: `node -v` e `npm -v`.
2. **Git** (opcional, para clonar):
   - Baixe em: [git-scm.com](https://git-scm.com/).
3. Uma conta no [Meta for Developers](https://developers.facebook.com/) com um app configurado para o WhatsApp Cloud API.

---

## 🚀 Instalação e Execução na Máquina Local

Escolha o sistema operacional correspondente:

### 🍎 No macOS ou Linux

1. **Abra o Terminal** e clone o repositório (ou acesse a pasta descompactada):
   ```bash
   git clone https://github.com/adaylonborges/whatsapp-meta-sender.git
   cd whatsapp-meta-sender
   ```

2. **Copie o arquivo de exemplo de ambiente**:
   ```bash
   cp .env.example .env
   ```

3. **Instale as dependências**:
   ```bash
   npm install
   ```

4. **Inicie o servidor**:
   ```bash
   npm start
   ```

---

### 🪟 No Windows (PowerShell ou Prompt de Comando)

1. **Abra o PowerShell** ou **CMD** e clone o repositório (ou acesse a pasta onde baixou o projeto):
   ```powershell
   git clone https://github.com/adaylonborges/whatsapp-meta-sender.git
   cd whatsapp-meta-sender
   ```

2. **Crie o arquivo de ambiente `.env`**:
   - No **PowerShell**:
     ```powershell
     Copy-Item .env.example .env
     ```
   - No **CMD**:
     ```cmd
     copy .env.example .env
     ```

3. **Instale as dependências**:
   ```powershell
   npm install
   ```

4. **Inicie o servidor**:
   ```powershell
   npm start
   ```

---

### 🔑 Configuração das Credenciais da Meta

Abra o arquivo `.env` recém-criado em qualquer editor (VS Code, Bloco de Notas, etc.) e preencha com seus dados:

```env
# ID do Número encontrado em: Meta for Developers > WhatsApp > API Setup
META_PHONE_NUMBER_ID=seu_phone_number_id_aqui

# Token de Acesso temporário (24h) ou permanente (System User)
META_ACCESS_TOKEN=seu_access_token_aqui

PORT=3000
WEBHOOK_VERIFY_TOKEN=meu_token_secreto_webhook_123
```

> **Dica**: Você também pode deixar o `.env` vazio e preencher o *Phone Number ID* e o *Access Token* diretamente no topo da tela do navegador, clicando no botão **"Salvar no Navegador"**!

Acesse no navegador:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 💡 Como Funciona a Integração com a Meta

Toda a comunicação com o WhatsApp acontece através da **Graph API da Meta**:
- **Endpoint**: `https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`
- **Cabeçalho**: `Authorization: Bearer {ACCESS_TOKEN}`

### ⚠️ Diferença Crítica de IDs da Meta:
- **Phone Number ID** (ex: `104523958921832`): Identifica a linha do WhatsApp que vai **disparar**. É esse que a aplicação usa!
- **WABA ID (WhatsApp Business Account ID)**: Identifica a conta comercial proprietária do número. Não deve ser usado no endpoint de envio.

---

## 📜 Regras de Negócio do WhatsApp (Muito Importante)

### 1. Janela de 24 horas (Customer Care Window)
- **Mensagem Ativa (Iniciada pela Empresa)**: Se você está iniciando contato com o cliente ou se o cliente não mandou mensagem nas últimas 24 horas, você **obrigatoriamente deve usar um Template pré-aprovado pela Meta** (HSM).
- **Mensagem Reativa (Dentro da Janela)**: Se o cliente mandou mensagem para você há menos de 24 horas, você pode enviar **Texto Livre**, links, imagens, áudios, etc.

### 2. Números em Modo de Teste da Meta
- Enquanto você usa o número de teste gratuito da Meta, os envios só chegam para números que foram **previamente cadastrados e verificados** na lista de destinatários permitidos em:
  * *Meta for Developers > WhatsApp > API Setup > To (Destinatário) > Manage phone number list*.
- Em modo de produção (com número próprio registrado e empresa verificada), é possível disparar para qualquer número válido.

### 3. Template Padrão de Teste
A Meta fornece por padrão o template:
- Nome: `hello_world`
- Idioma: `en_US`

---

## 🔌 Endpoints da API Backend

### 1. `POST /api/send-single`
Envia mensagem individual (transacional).
- **Body Exemplo (Template)**:
  ```json
  {
    "recipient": "5511999998888",
    "type": "template",
    "templateName": "hello_world",
    "templateLang": "en_US",
    "templateParams": []
  }
  ```
- **Body Exemplo (Texto livre para janela de 24h)**:
  ```json
  {
    "recipient": "5511999998888",
    "type": "text",
    "textMessage": "Olá! Seu pedido #1234 foi enviado."
  }
  ```

### 2. `POST /api/send-batch`
Processa disparos em lote com intervalo de segurança (delay).
- **Body Exemplo**:
  ```json
  {
    "recipients": ["5511999998888", "5511988887777"],
    "delaySeconds": 2,
    "type": "template",
    "templateName": "hello_world",
    "templateLang": "en_US",
    "templateParams": []
  }
  ```

### 3. `GET /webhook` e `POST /webhook`
- `GET`: Validação obrigatória da Meta usando `hub.verify_token` e retorno do `hub.challenge`.
- `POST`: Recebe notificações assíncronas de status (`sent`, `delivered`, `read`) e mensagens enviadas pelos clientes.

### 4. `GET /api/logs`
Retorna a lista dos últimos 200 eventos e disparos armazenados em memória para exibição em tempo real na interface.

---

## 📡 Configuração do Webhook

Para receber as atualizações em tempo real no ambiente local:
1. Exponha sua porta 3000 usando [ngrok](https://ngrok.com/) ou [localtunnel](https://localtunnel.me/):
   ```bash
   npx localtunnel --port 3000
   ```
2. No painel do seu app na Meta:
   - Vá em **WhatsApp > Configuration > Webhook > Edit**.
   - **Callback URL**: `https://seu-dominio.loca.lt/webhook`
   - **Verify Token**: `meu_token_secreto_webhook_123` (ou o que estiver no `.env`).
3. Clique em **Verify and Save** e ative a assinatura do campo `messages`.

---

## 🤖 Guia de Evolução com IA (Claude)

Você e seus amigos podem passar esta pasta inteira ou o `README.md` para o **Claude** com prompts como estes:

### Ideias de Evolução para pedir ao Claude:
1. **Adicionar Banco de Dados (SQLite / PostgreSQL / Prisma)**:
   > *"Claude, adicione o Prisma ORM com SQLite neste projeto para persistir o histórico de disparos, status de entrega do webhook e contatos."*
2. **Importação de CSV / Excel**:
   > *"Claude, adicione uma funcionalidade na aba de envio em massa para que eu possa fazer upload de um arquivo .xlsx/.csv contendo número e nome do cliente para preencher variáveis dinâmicas do template."*
3. **Fila com Redis / BullMQ**:
   > *"Claude, refatore a rota `/api/send-batch` para usar BullMQ e Redis para que o envio em massa rode em background como fila assíncrona com retentativas automáticas."*
4. **Chatbot com IA (OpenAI / Anthropic / Gemini)**:
   > *"Claude, quando o endpoint `POST /webhook` receber uma nova mensagem de texto de um cliente, chame uma LLM para gerar a resposta e responda de volta usando a rota `/api/send-single`."*
