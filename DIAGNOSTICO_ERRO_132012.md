# 📋 Diagnóstico e Guia de Correção: Erro (#132012) na Meta Cloud API

> **Erro apresentado:**  
> `(#132012) Parameter format does not match format in the created template (Trace: A5d4kj1VZ4iBfq2AMPVcPEy)`

---

## 1. 🔍 De onde veio o diagnóstico?

As informações abaixo foram obtidas consultando diretamente a **Graph API oficial da Meta** através do endpoint da sua conta comercial (**WABA ID: `1024545617120343`**):

```http
GET https://graph.facebook.com/v21.0/1024545617120343/message_templates
Authorization: Bearer <SEU_META_ACCESS_TOKEN>
```

Esse endpoint retorna a estrutura oficial e o status de aprovação de cada template registrado no seu **WhatsApp Business Manager**.

---

## 2. 🧩 Estrutura dos seus Templates Aprovados na Meta

Abaixo está o raio-x exato dos modelos cadastrados na sua conta:

| Nome do Template | Idioma | Cabeçalho (Header) | Variáveis no Corpo (`{{1}}`) | Botão |
| :--- | :---: | :---: | :---: | :---: |
| `20261023_wpp_20off_evo_img_pt` | `pt_BR` | 🖼️ **IMAGEM** | ❌ Nenhuma | 🔗 Bora pro app! |
| `20261023_wpp_20off_vomero_img` | `pt_BR` | 🖼️ **IMAGEM** | ❌ Nenhuma | 🔗 Bora pro app! |
| `teste` | `pt_BR` | ❌ Sem imagem | ❌ Nenhuma | ❌ Sem botão |
| `20261023_wpp_20off_ofertas` | `pt_BR` | ❌ Sem imagem | ❌ Nenhuma | 🔗 Bora pro app! |
| `20261023_wpp_20off_evo` | `pt_BR` | ❌ Sem imagem | ❌ Nenhuma | 🔗 Eu quero! |
| `wpp_reativacao90d_09102026` | `pt_BR` | ❌ Sem imagem | ❌ Nenhuma | 🔗 Bora |

---

## 3. 🚨 Por que o erro `#132012` aconteceu?

O erro **`Parameter format does not match format in the created template`** significa que o payload enviado pelo frontend não bate com o formato exigido pelo template selecionado.

Isso acontece em dois cenários:

### ⚠️ Cenário A: Mandou imagem para um template que NÃO tem imagem
- **O que aconteceu**: O campo *"Nome do Template"* estava como `teste` (ou outro template de texto puro), mas o campo *"URL da Imagem de Cabeçalho"* foi preenchido.
- **Resposta da Meta**: Rejeição imediata, porque o template `teste` não aceita componente do tipo `HEADER`.

### ⚠️ Cenário B: Mandou variáveis de texto para um template sem variáveis
- **O que aconteceu**: O template selecionado foi `20261023_wpp_20off_evo_img_pt` (que aceita imagem), mas foram passados valores no campo *"Parâmetros das Variáveis"* ou mapeada uma coluna de nome no CSV como `{{1}}`.
- **Resposta da Meta**: Rejeição imediata, porque o texto cadastrado no corpo desse template é 100% estático (não contém `{{1}}`).

---

## 4. ✅ O que fazer para corrigir (Passo a Passo)

### 👉 Opção 1: Se você quer disparar COM IMAGEM

Use um dos dois templates oficiais criados para imagem:

1. **Nome do Template na Meta**:
   - `20261023_wpp_20off_evo_img_pt` *(Adidas Evo SL)*  
   OU  
   - `20261023_wpp_20off_vomero_img` *(Nike Vomero 18)*
2. **Idioma**:
   - `pt_BR`
3. **URL da Imagem de Cabeçalho**:
   - Insira uma URL pública válida (link direto `.jpg` ou `.png`).
4. **Parâmetros das Variáveis {{1}}**:
   - **DEIXE EM BRANCO**!
   - Se estiver usando CSV: No seletor da coluna `{{1}}`, selecione **"Nenhum (usar padrão)"**.

---

### 👉 Opção 2: Se você quer disparar o template `teste` (Sem Imagem)

1. **Nome do Template na Meta**:
   - `teste`
2. **Idioma**:
   - `pt_BR`
3. **URL da Imagem de Cabeçalho**:
   - **DEIXE COMPLETAMENTE VAZIO**.
4. **Parâmetros das Variáveis**:
   - **DEIXE COMPLETAMENTE VAZIO**.

---

## 5. 💡 Resumo da Regra de Ouro

| Template | URL da Imagem | Parâmetros {{1}} |
| :--- | :---: | :---: |
| `20261023_wpp_20off_evo_img_pt` | **Obrigatório** | **Deixar Vazio** |
| `20261023_wpp_20off_vomero_img` | **Obrigatório** | **Deixar Vazio** |
| `teste` | **Deixar Vazio** | **Deixar Vazio** |
| `20261023_wpp_20off_ofertas` | **Deixar Vazio** | **Deixar Vazio** |
