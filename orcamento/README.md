# Formação de preço e acompanhamento de contratos

Página: **https://gcos.starqia.com/orcamento/**

Ferramenta estática (HTML + JS, sem servidor) publicada pelo GitHub Pages junto com o site. Reproduz a sistemática da planilha *MODELO ORÇAMENTO PORTARIA E RONDA* (Módulos 1 a 5 e retenções) e acrescenta o acompanhamento mensal do contrato.

| Arquivo | Conteúdo |
|---|---|
| `engine.js` | Motor de cálculo puro: formação do preço, comparação orçado x realizado e variação mês a mês |
| `app.js` | Interface: formulário, resumo, contratos, lançamentos mensais |
| `pdf.js` | PDF da proposta (cliente) e do relatório de acompanhamento |
| `styles.css` | Identidade visual GCOS |

## Abas

- **Formação de preço:** cargos, benefícios, insumos, encargos (4.1 a 4.5), custos indiretos, lucro e tributos. Simples Nacional (alíquota efetiva pela RBT12 dos Anexos III, IV e V, ou informada) ou Lucro Presumido (PIS, COFINS, IRPJ, CSLL e ISS). Os tributos são calculados por dentro: alíquota × valor da fatura.
- **Acompanhamento mensal:** para cada competência, os realizados de remuneração, benefícios, insumos, encargos, custos indiretos, tributos e faturamento. Mostra:
  - orçado x realizado, com tolerância configurável por contrato;
  - variação mês a mês de cada custo realizado (Δ %, Δ R$ ou valores), custo total e custo por funcionário;
  - versões do orçamento com vigência (reajuste/repactuação): cada mês é comparado com a versão vigente naquele mês;
  - relatório em PDF.
- **Contratos:** lista, edição, duplicação, exclusão e backup/importação em JSON.

## Onde ficam os dados

**Sem link de acesso:** os contratos ficam só no `localStorage` do navegador de quem usa. Para trocar de computador, use **Exportar backup** e **Importar backup** na aba Contratos.

**Com link de acesso (`/orcamento/?k=<chave>`):** os contratos da empresa ficam no Google Drive do dono do Apps Script *STARQIA Orçamentos – Armazenamento* (código em `apps-script/Codigo.gs`, URL em `GCOS_CONFIG.orcamentoApiUrl`).

- Cada alteração é enviada ao Drive cerca de 1 s depois; a barra no topo mostra o estado. Sem internet, os dados ficam no navegador e são enviados quando a conexão volta.
- O Apps Script junta os dados contrato a contrato (vale o mais recente) e registra exclusões, então dois computadores podem usar a mesma empresa.
- Na pasta da empresa: `dados.json`, a planilha *Acompanhamento – Empresa* (abas Lançamentos e Contratos), `PDFs/` e `Backups/` (uma cópia por dia).
- Empresas e chaves: planilha *STARQIA Orçamentos – Empresas e chaves*, na pasta *STARQIA Orçamentos* do Drive. Para bloquear uma empresa, mude **Ativo** para FALSE.
- Nova empresa: no editor do Apps Script, crie uma função como `criarEmpresa_WF` (nome e, se quiser, o ID da pasta do cliente onde criar a pasta), rode e copie o link do registro de execução ou da planilha de empresas.
- Ao alterar `Codigo.gs`, publique em **Implantar > Gerenciar implantações > editar > Nova versão**, para manter a mesma URL.

## Leads e cópia das simulações

Ao gerar o PDF da proposta, o visitante informa nome, e-mail e WhatsApp (com consentimento). A página envia ao mesmo webhook do site (`GCOS_CONFIG.leadWebhookUrl` em `index.html`) duas mensagens `text/plain` com JSON:

1. `{"type":"lead.created", "lead":{..., "source":"orcamento-pdf", "message":"<resumo da simulação>"}}`: mesmo formato dos leads do formulário do site.
2. `{"type":"orcamento.pdf", "email", "name", "company", "fileName", "pdfBase64", "simulacao", "totais"}`: o PDF que o visitante baixou e os dados completos da simulação.

Também envia eventos anônimos de funil (`type:"evt"`): `orcamento_pdf`, `orcamento_contrato_salvo`, `orcamento_mes_lancado`, entre outros.

Para guardar a cópia do PDF no Drive, acrescente ao `doPost` do Apps Script:

```js
// dentro de doPost(e), depois de: const data = JSON.parse(e.postData.contents);
if (data.type === 'orcamento.pdf') {
  const pasta = DriveApp.getFolderById('ID_DA_PASTA_NO_DRIVE');
  const blob = Utilities.newBlob(Utilities.base64Decode(data.pdfBase64), 'application/pdf', data.fileName);
  const arq = pasta.createFile(blob);
  arq.setDescription(`${data.name} · ${data.company || ''} · ${data.email}`);
  MailApp.sendEmail('fabio@starqia.com', 'Nova simulação de formação de preço: ' + (data.company || data.name),
    `${data.name} (${data.email}) gerou uma proposta.\nPDF: ${arq.getUrl()}`);
  return ContentService.createTextOutput('ok');
}
```

## Teste rápido do motor

No console do navegador, na página `/orcamento/`:

```js
const r = StarqiaEngine.calcular(StarqiaEngine.modeloPadrao('portaria'));
r.modulos.m1 // 7320.07: igual à aba "VENDAS ORÇAMENTO PORTARIA + RON" da planilha
```
