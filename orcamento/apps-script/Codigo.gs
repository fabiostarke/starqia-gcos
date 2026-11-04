/**
 * STARQIA Orçamentos – armazenamento no Google Drive
 *
 * Web app (Executar como: eu · Quem pode acessar: qualquer pessoa) que guarda os
 * contratos da ferramenta gcos.starqia.com/orcamento/ no Drive do dono do script.
 *
 * Estrutura no Drive:
 *   STARQIA Orçamentos/
 *     STARQIA Orçamentos – Empresas e chaves   (planilha: uma linha por empresa)
 *     <Empresa>/
 *       dados.json                             (contratos, versões e lançamentos)
 *       Acompanhamento – <Empresa>             (planilha legível, atualizada a cada salvamento)
 *       PDFs/                                  (propostas e relatórios gerados)
 *       Backups/dados_AAAA-MM-DD.json          (uma cópia por dia)
 *
 * Cada empresa acessa com um link https://gcos.starqia.com/orcamento/?k=<chave>.
 * Para criar uma empresa: rode criarEmpresa('Nome') no editor (ou uma função atalho).
 * Para bloquear o acesso: mude "Ativo" para FALSE na planilha de empresas.
 */

const PROP_RAIZ = 'ROOT_FOLDER_ID';
const PROP_CFG = 'CONFIG_SHEET_ID';
const SITE = 'https://gcos.starqia.com/orcamento/';

// ───────────────────────── administração (rodar no editor) ─────────────────────────

function setup() {
  const p = PropertiesService.getScriptProperties();
  let raizId = p.getProperty(PROP_RAIZ);
  if (!raizId) { raizId = DriveApp.createFolder('STARQIA Orçamentos').getId(); p.setProperty(PROP_RAIZ, raizId); }
  let cfgId = p.getProperty(PROP_CFG);
  if (!cfgId) {
    const ss = SpreadsheetApp.create('STARQIA Orçamentos – Empresas e chaves');
    const sh = ss.getSheets()[0];
    sh.setName('Empresas');
    sh.appendRow(['Empresa', 'Chave de acesso', 'Link de acesso', 'Pasta no Drive', 'Ativo', 'Criado em']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 6).setFontWeight('bold');
    DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(raizId));
    cfgId = ss.getId();
    p.setProperty(PROP_CFG, cfgId);
  }
  return { raizId, cfgId };
}

/** pastaPaiId (opcional): cria a pasta da empresa dentro de uma pasta existente (ex.: a pasta do cliente) */
function criarEmpresa(nome, pastaPaiId) {
  const ids = setup();
  const pai = DriveApp.getFolderById(pastaPaiId || ids.raizId);
  const pasta = pai.createFolder(pastaPaiId ? 'STARQIA Orçamentos – ' + nome : nome);
  const chave = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 32);
  const link = SITE + '?k=' + chave;
  SpreadsheetApp.openById(ids.cfgId).getSheetByName('Empresas').appendRow([nome, chave, link, pasta.getUrl(), true, new Date()]);
  Logger.log('Empresa: ' + nome + '\nLink de acesso: ' + link + '\nPasta: ' + pasta.getUrl());
  return link;
}

// W&F: pasta dentro de "W&F grupo wctech - 298"
function criarEmpresa_WF() { return criarEmpresa('W&F', '1L8G-oTJi1O7IBuQBtQ9Sf5OHn2CyIygE'); }

// WISDOM Segurança: pasta dentro de "WISDOM SEGURANÇA LTDA - 224"
function criarEmpresa_WISDOM() { return criarEmpresa('WISDOM Segurança', '1XAHBTKvQMhhBak21sBQhI-Gdh2FisPVk'); }

// ───────────────────────── web app ─────────────────────────

function doGet() { return json_({ ok: true, servico: 'STARQIA Orçamentos' }); }

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const emp = empresaPorChave_(req.chave);
    if (!emp) out = { ok: false, erro: 'chave' };
    else if (req.acao === 'carregar') out = carregar_(emp);
    else if (req.acao === 'salvar') out = salvar_(emp, req);
    else if (req.acao === 'pdf') out = salvarPdf_(emp, req);
    else out = { ok: false, erro: 'acao' };
  } catch (err) {
    out = { ok: false, erro: String(err && err.message || err) };
  }
  return json_(out);
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function empresaPorChave_(chave) {
  chave = String(chave || '');
  if (!/^[a-f0-9]{24,64}$/i.test(chave)) return null;
  const cache = CacheService.getScriptCache();
  const c = cache.get('emp_' + chave);
  if (c) return JSON.parse(c);
  const cfgId = PropertiesService.getScriptProperties().getProperty(PROP_CFG);
  if (!cfgId) return null;
  const v = SpreadsheetApp.openById(cfgId).getSheetByName('Empresas').getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][1]) !== chave) continue;
    if (v[i][4] === false || String(v[i][4]).toUpperCase() === 'FALSE') return null;
    const m = String(v[i][3]).match(/folders\/([\w-]+)/);
    if (!m) return null;
    const emp = { nome: String(v[i][0]), pastaId: m[1] };
    cache.put('emp_' + chave, JSON.stringify(emp), 300);
    return emp;
  }
  return null;
}

function pasta_(emp) { return DriveApp.getFolderById(emp.pastaId); }
function subpasta_(emp, nome) { const f = pasta_(emp); const it = f.getFoldersByName(nome); return it.hasNext() ? it.next() : f.createFolder(nome); }
function arquivo_(pasta, nome) { const it = pasta.getFilesByName(nome); return it.hasNext() ? it.next() : null; }

function lerDados_(emp) {
  const a = arquivo_(pasta_(emp), 'dados.json');
  if (!a) return { contratos: [], excluidos: {}, atualizadoEm: null };
  const d = JSON.parse(a.getBlob().getDataAsString('UTF-8'));
  d.contratos = d.contratos || []; d.excluidos = d.excluidos || {};
  return d;
}

function carregar_(emp) {
  const d = lerDados_(emp);
  return { ok: true, empresa: emp.nome, contratos: d.contratos, excluidos: d.excluidos, atualizadoEm: d.atualizadoEm };
}

/**
 * Junta o que veio do navegador com o que está no Drive, contrato a contrato:
 * vale a versão com "atualizadoEm" mais recente; exclusões ficam registradas em "excluidos".
 */
function salvar_(emp, req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const d = lerDados_(emp);
    const exc = Object.assign({}, d.excluidos, req.excluidos || {});
    const mapa = {};
    d.contratos.forEach(c => { mapa[c.id] = c; });
    (req.contratos || []).forEach(c => {
      if (!c || !c.id) return;
      const a = mapa[c.id];
      if (!a || String(c.atualizadoEm || '') >= String(a.atualizadoEm || '')) mapa[c.id] = c;
    });
    Object.keys(exc).forEach(id => { const c = mapa[id]; if (c && String(c.atualizadoEm || '') <= String(exc[id])) delete mapa[id]; });
    const contratos = Object.keys(mapa).map(k => mapa[k]).sort((a, b) => String(a.criadoEm || '').localeCompare(String(b.criadoEm || '')));
    const novo = { empresa: emp.nome, contratos, excluidos: exc, atualizadoEm: new Date().toISOString() };
    const txt = JSON.stringify(novo);
    const pasta = pasta_(emp);
    const a = arquivo_(pasta, 'dados.json');
    if (a) a.setContent(txt); else pasta.createFile('dados.json', txt, MimeType.PLAIN_TEXT);
    backupDiario_(emp, txt);
    if (req.planilha) { try { atualizarPlanilha_(emp, req.planilha); } catch (err) { console.warn('planilha: ' + err); } }
    return { ok: true, empresa: emp.nome, contratos, excluidos: exc, atualizadoEm: novo.atualizadoEm };
  } finally {
    lock.releaseLock();
  }
}

function backupDiario_(emp, txt) {
  const nome = 'dados_' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd') + '.json';
  const pasta = subpasta_(emp, 'Backups');
  const a = arquivo_(pasta, nome);
  if (a) a.setContent(txt); else pasta.createFile(nome, txt, MimeType.PLAIN_TEXT);
}

/** planilha: { abas: [{ nome, cabecalho:[...], formatos:['txt'|'brl'|'pct'|'int'|'data'], linhas:[[...]] }] } */
function atualizarPlanilha_(emp, planilha) {
  const p = PropertiesService.getScriptProperties();
  const chaveProp = 'SS_' + emp.pastaId;
  let ss = null;
  const id = p.getProperty(chaveProp);
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Acompanhamento – ' + emp.nome);
    DriveApp.getFileById(ss.getId()).moveTo(pasta_(emp));
    p.setProperty(chaveProp, ss.getId());
  }
  const fmt = { brl: 'R$ #,##0.00', pct: '0.0%', int: '0', data: 'dd/mm/yyyy hh:mm', txt: '@' };
  (planilha.abas || []).forEach(aba => {
    let sh = ss.getSheetByName(aba.nome);
    if (!sh) sh = ss.insertSheet(aba.nome);
    sh.clear();
    const linhas = [aba.cabecalho].concat(aba.linhas || []);
    const larg = aba.cabecalho.length;
    sh.getRange(1, 1, linhas.length, larg).setValues(linhas.map(l => { const x = l.slice(0, larg); while (x.length < larg) x.push(''); return x.map(v => v === null || v === undefined ? '' : v); }));
    sh.getRange(1, 1, 1, larg).setFontWeight('bold').setBackground('#e6f7ee');
    sh.setFrozenRows(1);
    if (linhas.length > 1) (aba.formatos || []).forEach((f, i) => { if (fmt[f] && f !== 'txt') sh.getRange(2, i + 1, linhas.length - 1, 1).setNumberFormat(fmt[f]); });
  });
  const padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao && ss.getSheets().length > 1) ss.deleteSheet(padrao);
}

function salvarPdf_(emp, req) {
  const nome = String(req.fileName || 'documento.pdf').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const blob = Utilities.newBlob(Utilities.base64Decode(String(req.pdfBase64 || '')), 'application/pdf', nome);
  const arq = subpasta_(emp, 'PDFs').createFile(blob);
  return { ok: true, url: arq.getUrl() };
}
