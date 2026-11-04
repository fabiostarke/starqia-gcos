/* STARQIA.GCOS – Formação de preço e acompanhamento mensal de contratos */
(function () {
  'use strict';
  const E = window.StarqiaEngine;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const fmt = E.fmt, pct = E.pct;

  // ───────────────────────── armazenamento local ─────────────────────────
  const K = { rascunho: 'starqia.orc.rascunho.v1', contratos: 'starqia.orc.contratos.v1', lead: 'starqia.orc.lead.v1', edicao: 'starqia.orc.edicao.v1' };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Não foi possível gravar neste navegador (armazenamento bloqueado).'); return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignora */ } },
  };

  // ───────────────────────── utilidades ─────────────────────────
  const clone = o => JSON.parse(JSON.stringify(o));
  const n0 = v => Number(v) || 0;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  function parseNum(s) {
    if (typeof s === 'number') return s;
    s = String(s || '').trim().replace(/\s|R\$|%/g, '');
    if (!s) return 0;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "2.000" = dois mil
    const v = parseFloat(s);
    return isFinite(v) ? v : 0;
  }
  const numBR = (v, max) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: max == null ? 2 : max });
  const money0 = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[last] = v; }
  const nomeArquivo = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  const mesLabel = m => { if (!m) return ''; const [y, mo] = m.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+mo - 1] + '/' + y; };
  const mesAtual = () => new Date().toISOString().slice(0, 7);
  const proxMes = m => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }

  // Medição anônima do funil (mesmo formato do site principal)
  const VISITA = Math.random().toString(36).slice(2, 12);
  function evento(e, x) {
    const url = window.GCOS_CONFIG && window.GCOS_CONFIG.leadWebhookUrl; if (!url) return;
    const body = JSON.stringify({ type: 'evt', e, v: VISITA, p: '/orcamento', s: 'outro', d: innerWidth < 768 ? 'mobile' : 'desktop', x: String(x || '').slice(0, 60) });
    try { fetch(url, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body }); } catch (e2) { /* ignora */ }
  }

  // ───────────────────────── estado ─────────────────────────
  let inp = store.get(K.rascunho, null) || E.modeloPadrao('portaria');
  let res = E.calcular(inp);
  let edicao = store.get(K.edicao, null); // {contratoId} quando editando nova versão de um contrato
  let contratos = store.get(K.contratos, []);
  function salvarContratos() { carimbar(); store.set(K.contratos, contratos); agendarNuvem(); }

  // ═════════════════════════ NUVEM (Google Drive via Apps Script) ═════════════════════════
  // Com um link de acesso (?k=chave), os contratos ficam guardados na pasta da empresa no Drive.
  // O navegador continua com uma cópia local; cada alteração é enviada ao Drive em seguida.
  const KN = { chave: 'starqia.orc.chave.v1', dono: 'starqia.orc.dono.v1', pend: 'starqia.orc.pendente.v1', exc: 'starqia.orc.excluidos.v1', guardados: 'starqia.orc.contratos.locais.v1' };
  const nuvem = { chave: null, empresa: null, estado: 'off', hora: null, timer: null, emVoo: false, denovo: false, pronto: false, assin: {} };
  const apiUrl = () => window.GCOS_CONFIG && window.GCOS_CONFIG.orcamentoApiUrl;
  const nuvemAtiva = () => !!(nuvem.chave && apiUrl() && nuvem.pronto);
  (function lerChave() {
    try {
      const u = new URL(location.href); const k = u.searchParams.get('k');
      if (k && /^[a-f0-9]{24,64}$/i.test(k)) { store.set(KN.chave, k); u.searchParams.delete('k'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
    } catch (e) { /* ignora */ }
    nuvem.chave = store.get(KN.chave, null);
  })();
  const semCarimbo = c => { const x = Object.assign({}, c); delete x.atualizadoEm; return JSON.stringify(x); };
  function assinar() { nuvem.assin = {}; contratos.forEach(c => { nuvem.assin[c.id] = semCarimbo(c); }); }
  // Marca com data/hora os contratos que mudaram desde a última sincronização
  function carimbar() {
    const agora = new Date().toISOString();
    contratos.forEach(c => { if (nuvem.assin[c.id] !== semCarimbo(c)) { c.atualizadoEm = agora; nuvem.assin[c.id] = semCarimbo(c); } });
  }
  function registrarExclusao(id) { const x = store.get(KN.exc, {}); x[id] = new Date().toISOString(); store.set(KN.exc, x); }
  async function api(corpo) {
    const r = await fetch(apiUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(Object.assign({ chave: nuvem.chave }, corpo)) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function estadoNuvem(e) {
    nuvem.estado = e; if (e === 'ok') nuvem.hora = new Date();
    const el = $('#nuvem'); if (!el) return;
    if (!nuvem.chave || !apiUrl()) { el.hidden = true; return; }
    const hh = nuvem.hora ? nuvem.hora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const txt = { carregando: 'Conectando ao Google Drive…', salvando: 'Salvando no Google Drive…', pend: 'Alterações ainda não enviadas ao Drive', ok: `Tudo salvo no Google Drive${hh ? ' às ' + hh : ''}`, erro: 'Sem conexão com o Drive. Os dados estão neste navegador e serão enviados assim que a conexão voltar.', chave: 'Link de acesso inválido ou desativado. Os dados ficam só neste navegador.' }[e] || '';
    el.hidden = false; el.className = 'nuvem-bar ' + e;
    el.innerHTML = `<div class="wrap"><span class="dot"></span><span>${nuvem.empresa ? `<b>${esc(nuvem.empresa)}</b> · ` : ''}${txt}</span>${e === 'erro' ? '<button type="button" data-n="tentar">Tentar agora</button>' : ''}<button type="button" data-n="sair">Desconectar este navegador</button></div>`;
  }
  function agendarNuvem() {
    if (!nuvemAtiva()) return;
    store.set(KN.pend, true); estadoNuvem('pend');
    clearTimeout(nuvem.timer); nuvem.timer = setTimeout(enviarNuvem, 1200);
  }
  // Monta a planilha legível que o Apps Script grava no Drive
  function planilhaNuvem() {
    const lanc = [], resumo = [];
    contratos.forEach(c => {
      let D; try { D = dadosContrato(c); } catch (e) { return; }
      D.comps.forEach(x => {
        const r = x.reg.real || {}, k = x.cmp, v = D.varia.find(z => z.mes === x.mes);
        const custo = v && v.custoTotal.valor;
        lanc.push([c.nome, c.cliente || '', x.mes, r.faturamento, r.remuneracao, r.beneficios, r.insumos, r.encargos, r.indiretos, r.tributos, custo, k.custoOrc,
          k.desvioCustoPct, v && v.resultado.valor, v && v.margem.valor, { ok: 'Dentro', atencao: 'Na tolerância', estouro: 'Acima', pendente: 'Pendente' }[k.status], x.reg.headcount, x.reg.obs || '']);
      });
      const ult = c.versoes[c.versoes.length - 1]; const ro = E.calcular(ult.inp);
      resumo.push([c.nome, c.cliente || '', c.versoes.length, ro.fatura, ro.headcount, D.meses.length, D.meses.length ? D.meses[D.meses.length - 1] : '', D.acum.real, D.acum.orc, D.acum.fat ? D.acum.res : '', D.acum.fat ? D.acum.res / D.acum.fat : '']);
    });
    return { abas: [
      { nome: 'Lançamentos', cabecalho: ['Contrato', 'Cliente', 'Competência', 'Faturamento', 'Remuneração', 'Benefícios', 'Insumos', 'Encargos', 'Custos indiretos', 'Tributos', 'Custo realizado', 'Custo orçado', 'Desvio do custo', 'Resultado (lucro/prejuízo)', 'Margem', 'Situação', 'Funcionários', 'Observações'],
        formatos: ['txt', 'txt', 'txt', 'brl', 'brl', 'brl', 'brl', 'brl', 'brl', 'brl', 'brl', 'brl', 'pct', 'brl', 'pct', 'txt', 'int', 'txt'], linhas: lanc },
      { nome: 'Contratos', cabecalho: ['Contrato', 'Cliente', 'Versões', 'Fatura orçada vigente', 'Funcionários orçados', 'Meses lançados', 'Último mês', 'Custo realizado acumulado', 'Custo orçado acumulado', 'Resultado acumulado', 'Margem acumulada'],
        formatos: ['txt', 'txt', 'int', 'brl', 'int', 'int', 'txt', 'brl', 'brl', 'brl', 'pct'], linhas: resumo },
    ] };
  }
  async function enviarNuvem() {
    if (!nuvemAtiva()) return;
    if (nuvem.emVoo) { nuvem.denovo = true; return; }
    nuvem.emVoo = true; estadoNuvem('salvando');
    try {
      const r = await api({ acao: 'salvar', contratos, excluidos: store.get(KN.exc, {}), planilha: planilhaNuvem() });
      if (!r.ok) throw new Error(r.erro || 'falha');
      store.set(KN.pend, false);
      aplicarServidor(r);
      estadoNuvem('ok');
    } catch (e) {
      estadoNuvem('erro');
      clearTimeout(nuvem.timer); nuvem.timer = setTimeout(enviarNuvem, 30000);
    } finally {
      nuvem.emVoo = false;
      if (nuvem.denovo) { nuvem.denovo = false; enviarNuvem(); }
    }
  }
  const porId = l => JSON.stringify(l.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))));
  // Troca a cópia local pela do Drive; só redesenha a tela se algo mudou (não atrapalha quem está digitando)
  function aplicarServidor(r) {
    nuvem.empresa = r.empresa || nuvem.empresa;
    store.set(KN.exc, r.excluidos || {});
    const lista = r.contratos || [];
    if (porId(lista) === porId(contratos)) { assinar(); return; }
    contratos = lista; store.set(K.contratos, contratos); store.set(KN.dono, nuvem.chave); assinar();
    redesenhar();
  }
  function redesenhar() {
    const aba = ($('.tabs button[aria-selected="true"]') || {}).dataset;
    if (aba && aba.tab === 'acomp') renderAcomp();
    if (aba && aba.tab === 'contratos') renderContratos();
    if (edicao && !contratos.find(c => c.id === edicao.contratoId)) { edicao = null; store.del(K.edicao); }
    renderResumo();
  }
  async function iniciarNuvem() {
    assinar();
    if (!nuvem.chave || !apiUrl()) { estadoNuvem('off'); return; }
    estadoNuvem('carregando');
    let r;
    try { r = await api({ acao: 'carregar' }); } catch (e) { nuvem.pronto = true; estadoNuvem('erro'); clearTimeout(nuvem.timer); nuvem.timer = setTimeout(iniciarNuvem, 30000); return; }
    if (!r.ok) { estadoNuvem(r.erro === 'chave' ? 'chave' : 'erro'); return; }
    nuvem.empresa = r.empresa; nuvem.pronto = true;
    const dono = store.get(KN.dono, null);
    if (dono !== nuvem.chave && contratos.length) {
      // Contratos que já estavam neste navegador, de antes do link de acesso
      const enviar = confirm(`Este navegador já tem ${contratos.length} contrato(s) salvo(s) fora do Drive.\n\nOK: enviar para a pasta de ${r.empresa} no Google Drive.\nCancelar: guardar à parte neste navegador e abrir só os contratos de ${r.empresa}.`);
      if (!enviar) { store.set(KN.guardados, contratos); contratos = []; }
      store.set(K.contratos, contratos); store.set(KN.dono, nuvem.chave); store.set(KN.pend, enviar);
      contratos.forEach(c => { c.atualizadoEm = c.atualizadoEm || new Date().toISOString(); });
    }
    store.set(KN.dono, nuvem.chave);
    if (store.get(KN.pend, false)) { aplicarServidorParcial(r); enviarNuvem(); }
    else { aplicarServidor(r); estadoNuvem('ok'); }
  }
  // Havia alterações locais não enviadas: junta com o Drive e envia (o Apps Script resolve contrato a contrato)
  function aplicarServidorParcial(r) {
    const loc = {}; contratos.forEach(c => { loc[c.id] = c; });
    const exc = store.get(KN.exc, {});
    (r.contratos || []).forEach(c => { if (!loc[c.id] && !exc[c.id]) contratos.push(c); else if (loc[c.id] && String(c.atualizadoEm || '') > String(loc[c.id].atualizadoEm || '')) Object.assign(loc[c.id], c); });
    store.set(K.contratos, contratos); assinar(); redesenhar();
  }
  function desconectar() {
    if (store.get(KN.pend, false) && !confirm('Há alterações que ainda não chegaram ao Drive. Desconectar mesmo assim?')) return;
    if (!confirm('Desconectar este navegador? Os contratos continuam no Google Drive; para voltar, abra de novo o link de acesso.')) return;
    [KN.chave, KN.dono, KN.pend, KN.exc].forEach(k => store.del(k));
    contratos = store.get(KN.guardados, []); store.del(KN.guardados); store.set(K.contratos, contratos);
    nuvem.chave = null; nuvem.empresa = null; nuvem.pronto = false; edicao = null; store.del(K.edicao);
    estadoNuvem('off'); assinar(); redesenhar(); toast('Navegador desconectado do Drive.');
  }
  function salvarPdfNuvem(doc, nome) {
    if (!nuvemAtiva()) return;
    try { api({ acao: 'pdf', fileName: nome, pdfBase64: doc.output('datauristring').split(',')[1] }).catch(() => {}); } catch (e) { /* ignora */ }
  }
  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-n]'); if (!b) return;
    if (b.dataset.n === 'sair') desconectar();
    if (b.dataset.n === 'tentar') { clearTimeout(nuvem.timer); nuvem.pronto ? enviarNuvem() : iniciarNuvem(); }
  });
  addEventListener('online', () => { if (nuvem.estado === 'erro') { clearTimeout(nuvem.timer); nuvem.pronto ? enviarNuvem() : iniciarNuvem(); } });
  addEventListener('beforeunload', ev => { if (nuvemAtiva() && store.get(KN.pend, false)) { ev.preventDefault(); ev.returnValue = ''; } });

  // ═════════════════════════ ABAS ═════════════════════════
  function abrirAba(t) {
    $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $$('.tab-panel').forEach(p => { p.hidden = p.id !== 'tab-' + t; });
    if (t === 'acomp') renderAcomp();
    if (t === 'contratos') renderContratos();
    try { history.replaceState(null, '', '#' + t); } catch (e) { /* ignora */ }
    scrollTo(0, 0);
  }
  $$('.tabs button').forEach(b => b.addEventListener('click', () => abrirAba(b.dataset.tab)));

  // ═════════════════════════ FORMAÇÃO DE PREÇO ═════════════════════════
  // Construtores de campos. data-path = caminho no objeto inp; data-t = tipo
  function campo(label, path, t, opt) {
    opt = opt || {};
    const v = getPath(inp, path);
    let ctl;
    if (t === 'select') {
      ctl = `<select data-path="${path}" data-t="text"${opt.rerender ? ' data-rerender' : ''}>${opt.options.map(o => `<option value="${esc(o[0])}"${String(v) === String(o[0]) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    } else if (t === 'text' || t === 'date' || t === 'textarea') {
      ctl = t === 'textarea'
        ? `<textarea data-path="${path}" data-t="text" rows="3" maxlength="1500">${esc(v)}</textarea>`
        : `<input type="${t}" data-path="${path}" data-t="text" value="${esc(v)}" maxlength="160">`;
    } else {
      const shown = t === 'pct' ? numBR(v * 100, 4) : numBR(v, t === 'int' ? 0 : 2);
      ctl = `<input inputmode="decimal" data-path="${path}" data-t="${t}" value="${shown}">`;
      if (t === 'pct') ctl = `<span class="suffix" data-suf="%">${ctl}</span>`;
      if (t === 'money') ctl = `<span class="prefix">${ctl}</span>`;
    }
    return `<label${opt.title ? ` title="${esc(opt.title)}"` : ''}>${esc(label)}${ctl}</label>`;
  }
  const cel = (path, t, opt) => campo('', path, t, opt).replace(/^<label[^>]*>/, '').replace(/<\/label>$/, '');
  function sec(num, titulo, totKey, corpo, aberto) {
    return `<details class="sec"${aberto ? ' open' : ''}><summary><span class="num">${num}</span><h2>${titulo}</h2>${totKey ? `<span class="tot" data-tot="${totKey}"></span>` : ''}</summary><div class="sec-body">${corpo}</div></details>`;
  }

  function renderForm() {
    const f = $('#form-preco');
    const abertos = $$('details.sec', f).map(d => d.open);
    const s = inp.simples;
    const regimeCorpo = `
      <div class="seg" role="group" aria-label="Regime tributário">
        <button type="button" data-regime="simples" aria-pressed="${inp.regime === 'simples'}">Simples Nacional</button>
        <button type="button" data-regime="presumido" aria-pressed="${inp.regime === 'presumido'}">Lucro Presumido</button>
      </div>
      ${inp.regime === 'simples' ? `
        <div class="fields">
          ${campo('Anexo', 'simples.anexo', 'select', { rerender: true, options: [['III', 'Anexo III'], ['IV', 'Anexo IV (vigilância, limpeza)'], ['V', 'Anexo V']] })}
          ${campo('Alíquota', 'simples.modo', 'select', { rerender: true, options: [['tabela', 'Calcular pela RBT12'], ['manual', 'Informar alíquota efetiva']] })}
          ${s.modo === 'tabela' ? campo('Receita bruta 12 meses (RBT12)', 'simples.rbt12', 'money') : campo('Alíquota efetiva do DAS', 'simples.aliquotaManual', 'pct')}
          ${campo('Outros tributos s/ faturamento', 'outrosTributosPct', 'pct')}
        </div>
        <p class="hint" data-aliq></p>
        ${s.anexo === 'IV' ? '<p class="note">No Anexo IV a contribuição previdenciária patronal (20% + RAT) não está no DAS. Ela entra no Módulo 4.1.</p>' : '<p class="note">Nos Anexos III e V a CPP está dentro do DAS. O Módulo 4.1 fica só com o FGTS.</p>'}
      ` : `
        <div class="fields">
          ${campo('PIS', 'presumido.pis', 'pct')}${campo('COFINS', 'presumido.cofins', 'pct')}
          ${campo('IRPJ (32% × 15%)', 'presumido.irpj', 'pct')}${campo('CSLL (32% × 9%)', 'presumido.csll', 'pct')}
          ${campo('ISS do município', 'presumido.iss', 'pct')}${campo('Outros tributos s/ faturamento', 'outrosTributosPct', 'pct')}
        </div>
        <p class="note">Se o lucro presumido trimestral da empresa passar de R$ 60 mil, há adicional de 10% de IRPJ. Informe esse efeito em "Outros tributos".</p>
      `}
      <p class="hint">Os tributos são calculados por dentro: incidem sobre o valor da fatura, e não sobre o custo.</p>`;

    const cargosRows = inp.cargos.map((c, i) => `<tr>
        <td>${cel(`cargos.${i}.desc`, 'text')}</td>
        <td style="width:70px">${cel(`cargos.${i}.qtd`, 'int')}</td>
        <td style="width:120px">${cel(`cargos.${i}.salario`, 'money')}</td>
        <td style="text-align:center"><input type="checkbox" data-path="cargos.${i}.noturno" data-t="bool" data-rerender ${c.noturno ? 'checked' : ''} aria-label="Noturno"></td>
        <td style="width:80px">${c.noturno ? cel(`cargos.${i}.horasNot`, 'num') : '–'}</td>
        <td style="width:70px">${c.noturno ? cel(`cargos.${i}.dsrNot`, 'num') : '–'}</td>
        <td style="width:90px">${cel(`cargos.${i}.periculosidadePct`, 'pct')}</td>
        <td style="width:90px">${cel(`cargos.${i}.insalubridadePct`, 'pct')}</td>
        <td style="width:110px">${cel(`cargos.${i}.gratificacao`, 'money')}</td>
        <td class="num" data-cargo-tot="${i}"></td>
        <td><button type="button" class="x" data-del="cargos" data-i="${i}" aria-label="Remover cargo">×</button></td></tr>`).join('');

    const benRows = inp.beneficios.itens.map((b, i) => `<tr>
        <td>${cel(`beneficios.itens.${i}.desc`, 'text')}</td>
        <td style="width:140px">${cel(`beneficios.itens.${i}.valor`, 'money')}</td>
        <td style="width:150px">${cel(`beneficios.itens.${i}.periodo`, 'select', { options: [['mensal', 'Mensal'], ['anual', 'Anual (÷ 12)']] })}</td>
        <td><button type="button" class="x" data-del="beneficios.itens" data-i="${i}" aria-label="Remover">×</button></td></tr>`).join('');

    const insRows = inp.insumos.map((b, i) => `<tr>
        <td>${cel(`insumos.${i}.desc`, 'text')}</td>
        <td style="width:70px">${cel(`insumos.${i}.qtd`, 'num')}</td>
        <td style="width:130px">${cel(`insumos.${i}.valor`, 'money')}</td>
        <td style="width:150px">${cel(`insumos.${i}.base`, 'select', { options: [['porFuncionario', 'Por funcionário'], ['fixo', 'Valor fixo']] })}</td>
        <td style="width:140px">${cel(`insumos.${i}.periodo`, 'select', { options: [['mensal', 'Mensal'], ['anual', 'Anual (÷ 12)']] })}</td>
        <td><button type="button" class="x" data-del="insumos" data-i="${i}" aria-label="Remover">×</button></td></tr>`).join('');

    const g = 'encargos.';
    const encCorpo = `
      <h3 class="hint" style="font-weight:700;color:var(--ink-900)">4.1 Encargos previdenciários e FGTS <span data-encpct="4.1"></span></h3>
      <div class="fields">${[['INSS patronal', 'inss'], ['SESI/SESC', 'sesi'], ['SENAI/SENAC', 'senai'], ['INCRA', 'incra'], ['Salário-educação', 'salEdu'], ['FGTS', 'fgts'], ['RAT × FAP', 'rat'], ['SEBRAE', 'sebrae']].map(x => campo(x[0], g + 'g41.' + x[1], 'pct')).join('')}</div>
      <button type="button" class="btn ghost-dark sm add" data-act="preset41">Aplicar padrão do regime selecionado</button>
      <h3 class="hint" style="font-weight:700;color:var(--ink-900);margin-top:18px">4.2 a 4.5 Provisões <span class="muted">(sobre a remuneração, com incidência do 4.1)</span></h3>
      <div class="fields">
        ${campo('13º salário', g + 'g42.decimo', 'pct')}
        ${campo('Afastamento maternidade', g + 'g43.maternidade', 'pct')}
        ${campo('Aviso prévio indenizado', g + 'g44.avisoIndenizado', 'pct')}
        ${campo('Multa FGTS s/ aviso indenizado', g + 'g44.multaFgtsAvisoInd', 'pct')}
        ${campo('Aviso prévio trabalhado', g + 'g44.avisoTrabalhado', 'pct')}
        ${campo('Multa FGTS s/ aviso trabalhado', g + 'g44.multaFgtsAvisoTrab', 'pct')}
        ${campo('Férias + 1/3', g + 'g45.ferias', 'pct')}
        ${campo('Ausência por doença', g + 'g45.doenca', 'pct')}
        ${campo('Licença-paternidade', g + 'g45.paternidade', 'pct')}
        ${campo('Ausências legais', g + 'g45.ausenciasLegais', 'pct')}
        ${campo('Acidente de trabalho', g + 'g45.acidente', 'pct')}
        ${campo('Outras ausências', g + 'g45.outros', 'pct')}
      </div>
      <div class="tbl-wrap"><table class="ed"><thead><tr><th>Submódulo</th><th class="num">% s/ remuneração</th><th class="num">Valor mensal</th></tr></thead><tbody data-enc-tbl></tbody></table></div>`;

    const html = [
      sec('00', 'Dados da proposta', null, `<div class="fields cols-2">
        ${campo('Nº da proposta', 'meta.proposta', 'text')}${campo('Cliente / tomador do serviço', 'meta.cliente', 'text')}
        ${campo('Serviço', 'meta.servico', 'text')}${campo('Local de execução', 'meta.local', 'text')}
        ${campo('Data', 'meta.data', 'date')}${campo('Validade (dias)', 'meta.validadeDias', 'int')}
      </div><div class="fields cols-2">${campo('Observações para a proposta', 'meta.observacoes', 'textarea')}</div>`, true),
      sec('RT', 'Regime tributário', null, regimeCorpo, true),
      sec('M1', 'Módulo 1 · Composição da remuneração', 'm1', `
        <div class="tbl-wrap"><table class="ed"><thead><tr><th>Cargo / posto</th><th>Qtd</th><th>Salário-base</th><th>Noturno</th><th>Horas not./mês</th><th>DSR (dias)</th><th>Periculosidade</th><th>Insalubridade</th><th>Gratificação</th><th class="num">Total</th><th></th></tr></thead><tbody>${cargosRows}</tbody></table></div>
        <button type="button" class="btn ghost-dark sm add" data-add="cargos">+ Adicionar cargo</button>
        <div class="fields">${campo('Salário mínimo (base da insalubridade)', 'salarioMinimo', 'money')}${campo('Horas extras / folguistas (FT) no mês', 'horaExtraFT', 'money')}${campo('Outras remunerações no mês', 'outrasRemuneracoes', 'money')}</div>
        <p class="hint">Adicional noturno com DSR: salário ÷ 220 × 20% × horas noturnas, mais o reflexo no DSR (÷ 26 × dias). Periculosidade incide sobre o salário-base; insalubridade, sobre o salário mínimo.</p>`, true),
      sec('M2', 'Módulo 2 · Benefícios mensais e diários', 'm2', `
        <div class="fields">
          ${campo('Tarifa do transporte', 'beneficios.vtTarifa', 'money')}${campo('Conduções por dia', 'beneficios.vtViagensDia', 'num')}
          ${campo('Dias trabalhados no mês', 'beneficios.vtDias', 'num')}${campo('Desconto VT do empregado', 'beneficios.vtDescontoPct', 'pct')}
          ${campo('Vale-refeição / alimentação por dia', 'beneficios.vaValorDia', 'money')}${campo('Dias de VA no mês', 'beneficios.vaDias', 'num')}
          ${campo('Desconto VA do empregado', 'beneficios.vaDescontoPct', 'pct')}
        </div>
        <div class="tbl-wrap"><table class="ed" style="min-width:480px"><thead><tr><th>Benefício (por funcionário)</th><th>Valor</th><th>Periodicidade</th><th></th></tr></thead><tbody>${benRows}</tbody></table></div>
        <button type="button" class="btn ghost-dark sm add" data-add="beneficios.itens">+ Adicionar benefício</button>
        <p class="hint">O desconto de VT é limitado ao próprio custo do vale.</p>`),
      sec('M3', 'Módulo 3 · Insumos diversos', 'm3', `
        <div class="tbl-wrap"><table class="ed"><thead><tr><th>Insumo</th><th>Qtd</th><th>Valor unitário</th><th>Base</th><th>Periodicidade</th><th></th></tr></thead><tbody>${insRows}</tbody></table></div>
        <button type="button" class="btn ghost-dark sm add" data-add="insumos">+ Adicionar insumo</button>`),
      sec('M4', 'Módulo 4 · Encargos sociais e trabalhistas', 'm4', encCorpo),
      sec('M5', 'Módulo 5 · Custos indiretos e lucro', 'ind', `<div class="fields">
        ${campo('Custos indiretos (% do subtotal)', 'indiretos.custosIndiretosPct', 'pct')}
        ${campo('Custo administrativo (% do subtotal)', 'indiretos.custoAdministrativoPct', 'pct')}
        ${campo('Seguros (% do subtotal)', 'indiretos.seguroPct', 'pct')}
        ${campo('Contribuição sindical patronal (anual)', 'indiretos.sindicatoPatronalAnual', 'money')}
        ${campo('Outros custos indiretos (mensal)', 'indiretos.outrosMensal', 'money')}
      </div>
      <h3 class="sub-h">Margem de lucro</h3>
      <div class="seg" role="group" aria-label="Como definir a margem de lucro">
        <button type="button" data-lucromodo="pct" aria-pressed="${inp.indiretos.lucroModo !== 'fatura'}">Margem de lucro (%)</button>
        <button type="button" data-lucromodo="fatura" aria-pressed="${inp.indiretos.lucroModo === 'fatura'}">Valor da fatura atual</button>
      </div>
      ${inp.indiretos.lucroModo === 'fatura' ? `
        <div class="fields">${campo('Valor da fatura atual (mensal)', 'indiretos.faturaAtual', 'money')}</div>
        <p class="hint" data-lucro-calc></p>
        <p class="note">Informe quanto você cobra hoje do cliente. O sistema desconta os tributos e os custos e mostra a margem de lucro que sobra.</p>` : `
        <div class="fields">${campo('Margem de lucro (% s/ subtotal + custos indiretos)', 'indiretos.lucroPct', 'pct')}</div>
        <p class="hint" data-lucro-calc></p>`}`),
      sec('RF', 'Retenções na fonte', 'ret', `<div class="fields">
        ${campo('INSS retido (cessão de mão de obra)', 'retencoes.inssPct', 'pct')}${campo('ISS retido', 'retencoes.issPct', 'pct')}
        ${campo('IRRF', 'retencoes.irPct', 'pct')}${campo('CSRF (PIS/COFINS/CSLL)', 'retencoes.csrfPct', 'pct')}
      </div><p class="hint">As retenções não mudam o preço. Mostram quanto o tomador recolhe por você e quanto entra de fato no caixa.</p>`),
      sec('QR', 'Quadro-resumo detalhado', null, '<div data-quadro></div>'),
    ].join('');
    f.innerHTML = html;
    $$('details.sec', f).forEach((d, i) => { if (abertos.length) d.open = abertos[i]; });
    atualizar();
  }

  // Atualiza números sem reconstruir o formulário (mantém o foco do usuário)
  function atualizar() {
    res = E.calcular(inp);
    store.set(K.rascunho, inp);
    const f = $('#form-preco');
    const tots = { m1: res.modulos.m1, m2: res.modulos.m2, m3: res.modulos.m3, m4: res.modulos.m4, ind: res.indiretos + res.lucro, ret: res.totalRetencoes };
    $$('[data-tot]', f).forEach(el => { el.textContent = fmt(tots[el.dataset.tot]); });
    $$('[data-cargo-tot]', f).forEach(el => { const c = res.cargos[+el.dataset.cargoTot]; el.textContent = c ? fmt(c.total) : ''; });
    const al = $('[data-aliq]', f);
    if (al) al.textContent = `Alíquota efetiva aplicada: ${pct(res.pctTributos)} sobre a fatura.`;
    const encT = $('[data-enc-tbl]', f);
    if (encT) encT.innerHTML = Object.keys(res.encargos).map(k => `<tr><td>${k} ${esc(res.encargos[k].desc)}</td><td class="num">${pct(res.encargos[k].pct)}</td><td class="num">${fmt(res.encargos[k].valor)}</td></tr>`).join('')
      + `<tr><td><b>Total do Módulo 4</b></td><td class="num"><b>${pct(res.pctEncargos)}</b></td><td class="num"><b>${fmt(res.modulos.m4)}</b></td></tr>`;
    const lc = $('[data-lucro-calc]', f);
    if (lc) lc.innerHTML = res.lucroModo === 'fatura'
      ? `<b class="${res.lucro < 0 ? 'up' : 'down'}">${res.lucro < 0 ? 'Prejuízo' : 'Lucro'} de ${fmt(Math.abs(res.lucro))} por mês</b>: margem de ${pct(res.lucroPct)} sobre subtotal + custos indiretos (${pct(res.margemPct)} da fatura).`
      : (inp.indiretos.lucroModo === 'fatura' ? 'Informe o valor da fatura para calcular a margem.' : `Lucro de ${fmt(res.lucro)} por mês, ${pct(res.margemPct)} da fatura.`);
    const e41 = $('[data-encpct="4.1"]', f); if (e41) e41.textContent = '· ' + pct(res.encargos['4.1'].pct);
    const q = $('[data-quadro]', f); if (q) q.innerHTML = quadroHTML(res);
    renderResumo();
  }

  function quadroHTML(r) {
    const mods = { 1: 'Módulo 1 · Remuneração', 2: 'Módulo 2 · Benefícios', 3: 'Módulo 3 · Insumos', 4: 'Módulo 4 · Encargos', 5: 'Módulo 5 · Custos indiretos, lucro e tributos' };
    let h = '<div class="tbl-wrap"><table class="ed" style="min-width:520px"><thead><tr><th>Item</th><th class="num">Valor mensal</th></tr></thead><tbody>';
    [1, 2, 3, 4, 5].forEach(m => {
      h += `<tr><td colspan="2" style="background:#fafbfa;font-weight:800">${mods[m]}</td></tr>`;
      r.linhas.filter(l => l.mod === m).forEach(l => { h += `<tr><td>${esc(l.cod)} · ${esc(l.desc)}</td><td class="num">${fmt(l.valor)}</td></tr>`; });
      if (m === 4) h += `<tr><td><b>Subtotal (Módulos 1 a 4)</b></td><td class="num"><b>${fmt(r.subtotal)}</b></td></tr>`;
    });
    h += `<tr><td><b>Valor mensal da fatura</b></td><td class="num"><b>${fmt(r.fatura)}</b></td></tr>`;
    r.retencoes.forEach(x => { h += `<tr><td>(−) ${esc(x.desc)} ${pct(x.pct)}</td><td class="num">${fmt(-x.valor)}</td></tr>`; });
    h += `<tr><td><b>Fatura líquida (entrada de caixa)</b></td><td class="num"><b>${fmt(r.faturaLiquida)}</b></td></tr></tbody></table></div>`;
    return h;
  }

  function renderResumo() {
    const r = res, F = r.fatura || 1;
    const comp = [
      ['Remuneração', r.modulos.m1, ''], ['Benefícios', r.modulos.m2, ''], ['Insumos', r.modulos.m3, ''],
      ['Encargos', r.modulos.m4, ''], ['Custos indiretos', r.indiretos, ''], ['Tributos', r.tributos, 't'], ['Lucro', r.lucro, 'l'],
    ];
    const emEdicao = edicao && contratos.find(c => c.id === edicao.contratoId);
    $('#resumo').innerHTML = `
      <div class="res-main">
        <div class="lbl">Valor mensal da fatura</div>
        <div class="big">${fmt(r.fatura)}</div>
        <div class="sub">${fmt(r.fatura * 12)} por ano · ${esc(inp.regime === 'simples' ? 'Simples Nacional, Anexo ' + inp.simples.anexo : 'Lucro Presumido')}</div>
        <div class="kpis">
          <div class="kpi"><span>Funcionários</span><b>${numBR(r.headcount, 0)}</b></div>
          <div class="kpi"><span>Preço por funcionário</span><b>${money0(r.porFuncionario)}</b></div>
          <div class="kpi"><span>Custo operacional</span><b>${money0(r.custoTotal)}</b></div>
          <div class="kpi"><span>Fatura líquida</span><b>${money0(r.faturaLiquida)}</b></div>
        </div>
      </div>
      <div class="card comp">
        <h3>Composição de cada real faturado</h3>
        ${comp.map(c => `<div class="bar-row"><span>${c[0]}</span><span class="v">${fmt(c[1])} · ${pct(c[1] / F, 1)}</span><div class="bar ${c[2]}"><i style="width:${Math.max(0, Math.min(100, c[1] / F * 100))}%"></i></div></div>`).join('')}
        <p class="hint">Encargos sobre a remuneração: ${pct(r.pctEncargos)} · Tributos sobre a fatura: ${pct(r.pctTributos)}</p>
      </div>
      <div class="res-actions">
        <button class="btn primary block" data-act="pdf">Baixar proposta em PDF</button>
        <button class="btn ghost-dark block" data-act="salvar">${emEdicao ? 'Salvar nova versão de “' + esc(emEdicao.nome) + '”' : 'Salvar como contrato para acompanhar'}</button>
        ${emEdicao ? '<button class="btn ghost-dark block sm" data-act="sair-edicao">Sair da edição do contrato</button>' : ''}
      </div>`;
  }

  // Eventos do formulário
  const form = $('#form-preco');
  form.addEventListener('input', ev => {
    const el = ev.target; if (!el.dataset.path) return;
    const t = el.dataset.t;
    let v;
    if (t === 'bool') v = el.checked;
    else if (t === 'text') v = el.value;
    else if (t === 'pct') v = parseNum(el.value) / 100;
    else v = parseNum(el.value);
    setPath(inp, el.dataset.path, v);
    if (el.hasAttribute('data-rerender')) renderForm(); else atualizar();
  });
  form.addEventListener('change', ev => {
    const el = ev.target;
    if (el.dataset.t && el.dataset.t !== 'text' && el.dataset.t !== 'bool' && el.tagName === 'INPUT') {
      const v = getPath(inp, el.dataset.path);
      el.value = el.dataset.t === 'pct' ? numBR(v * 100, 4) : numBR(v, el.dataset.t === 'int' ? 0 : 2);
    }
  });
  form.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.regime) { mudarRegime(b.dataset.regime); return; }
    if (b.dataset.lucromodo) {
      const ind = inp.indiretos;
      if (b.dataset.lucromodo === 'fatura' && ind.lucroModo !== 'fatura' && !n0(ind.faturaAtual)) ind.faturaAtual = E.r2(res.fatura);
      if (b.dataset.lucromodo === 'pct' && ind.lucroModo === 'fatura' && res.lucroModo === 'fatura') ind.lucroPct = res.lucroPct;
      ind.lucroModo = b.dataset.lucromodo; renderForm(); return;
    }
    if (b.dataset.add) {
      const lista = getPath(inp, b.dataset.add);
      if (b.dataset.add === 'cargos') lista.push({ desc: 'Novo cargo', qtd: 1, salario: 0, noturno: false, horasNot: 105, dsrNot: 3.5, periculosidadePct: 0, insalubridadePct: 0, gratificacao: 0 });
      else if (b.dataset.add === 'insumos') lista.push({ desc: 'Novo insumo', qtd: 1, valor: 0, base: 'fixo', periodo: 'mensal' });
      else lista.push({ desc: 'Novo benefício', valor: 0, periodo: 'mensal' });
      renderForm(); return;
    }
    if (b.dataset.del) { getPath(inp, b.dataset.del).splice(+b.dataset.i, 1); renderForm(); return; }
    if (b.dataset.act === 'preset41') { aplicarPreset41(); renderForm(); toast('Encargos do Módulo 4.1 ajustados ao regime.'); }
  });
  // selects com data-rerender (anexo/modo) também disparam via 'input'; anexo muda o 4.1
  form.addEventListener('input', ev => { if (ev.target.dataset.path === 'simples.anexo') { aplicarPreset41(); renderForm(); } });

  function aplicarPreset41() {
    const key = inp.regime === 'presumido' ? 'presumido' : 'simples_' + inp.simples.anexo;
    inp.encargos.g41 = clone(E.PRESETS_41[key]);
  }
  function mudarRegime(r) {
    if (inp.regime === r) return;
    inp.regime = r;
    aplicarPreset41();
    if (r === 'presumido') { inp.retencoes.irPct = 0.01; inp.retencoes.csrfPct = 0.0465; }
    else { inp.retencoes.irPct = 0; inp.retencoes.csrfPct = 0; }
    renderForm();
    toast(r === 'presumido' ? 'Lucro Presumido: encargos com terceiros e retenções de IR/CSRF aplicados.' : 'Simples Nacional: encargos e retenções ajustados.');
  }

  // Ações gerais (hero, resumo)
  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'modelo') { if (!confirmarTroca()) return; inp = E.modeloPadrao(b.dataset.modelo); renderForm(); toast('Modelo carregado.'); evento('orcamento_modelo', b.dataset.modelo); }
    if (a === 'zerar') { if (!confirmarTroca()) return; inp = modeloZerado(); renderForm(); }
    if (a === 'pdf') pedirPDF();
    if (a === 'salvar') salvarContratoDialog();
    if (a === 'sair-edicao') { edicao = null; store.del(K.edicao); renderResumo(); toast('Edição encerrada. O rascunho continua na tela.'); }
    if (a === 'fechar-lead') $('#dlg-lead').close();
  });
  function confirmarTroca() { return confirm('Substituir os dados que estão na tela? O rascunho atual será perdido (contratos salvos não são afetados).'); }
  function modeloZerado() {
    const m = E.modeloPadrao('portaria');
    m.meta.servico = '';
    m.cargos = [{ desc: 'Cargo 1', qtd: 1, salario: 0, noturno: false, horasNot: 105, dsrNot: 3.5, periculosidadePct: 0, insalubridadePct: 0, gratificacao: 0 }];
    m.horaExtraFT = 0;
    m.beneficios.itens.forEach(i => { i.valor = 0; });
    m.beneficios.vtTarifa = 0; m.beneficios.vaValorDia = 0;
    m.insumos = [];
    return m;
  }

  // ───────────────────────── PDF + lead ─────────────────────────
  function pedirPDF() {
    if (!(res.fatura > 0)) { toast('Preencha ao menos um cargo com salário para gerar a proposta.'); return; }
    const lead = store.get(K.lead, null);
    if (lead) { gerarPDF(lead); return; }
    const d = $('#dlg-lead'); $('#lead-erro').textContent = '';
    if (typeof d.showModal === 'function') d.showModal(); else gerarPDF({ name: 'Visitante' });
    evento('orcamento_pdf_abriu');
  }
  $('#form-lead').addEventListener('submit', ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const l = Object.fromEntries(fd.entries());
    const erro = m => { $('#lead-erro').textContent = m; };
    if (l.website) { $('#dlg-lead').close(); return; } // armadilha anti-robô
    if ((l.name || '').trim().length < 2) return erro('Informe seu nome.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((l.email || '').trim())) return erro('Informe um e-mail válido.');
    const dig = (l.whatsapp || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (dig.length < 10 || dig.length > 11) return erro('Informe um WhatsApp válido com DDD.');
    if (!l.consent) return erro('É necessário concordar com o tratamento dos dados.');
    const lead = { name: l.name.trim(), company: (l.company || '').trim(), email: l.email.trim(), whatsapp: '55' + dig, consent: true };
    store.set(K.lead, lead);
    $('#dlg-lead').close();
    gerarPDF(lead);
  });

  function gerarPDF(lead) {
    if (!window.StarqiaPDF || !window.jspdf) { toast('O gerador de PDF não carregou. Verifique a conexão e tente de novo.'); return; }
    const doc = window.StarqiaPDF.proposta(inp, res, lead);
    const nome = `Proposta_${nomeArquivo(inp.meta.cliente || inp.meta.servico || 'simulacao')}_${inp.meta.data || ''}.pdf`;
    doc.save(nome);
    salvarPdfNuvem(doc, nome);
    toast('PDF gerado.');
    evento('orcamento_pdf', inp.regime);
    enviarCopia(lead, doc, nome);
  }

  // Envia a simulação ao webhook do site (mesmo formato de lead do site principal)
  function enviarCopia(lead, doc, nome) {
    const url = window.GCOS_CONFIG && window.GCOS_CONFIG.leadWebhookUrl; if (!url || !lead || !lead.email) return;
    const resumo = [
      `Simulação de formação de preço – ${inp.meta.servico || ''}`,
      `Cliente/tomador: ${inp.meta.cliente || '-'} · Local: ${inp.meta.local || '-'}`,
      `Regime: ${inp.regime === 'simples' ? 'Simples Nacional, Anexo ' + inp.simples.anexo : 'Lucro Presumido'}`,
      `Funcionários: ${res.headcount} · Fatura mensal: ${fmt(res.fatura)} · Por funcionário: ${fmt(res.porFuncionario)}`,
      `Remuneração ${fmt(res.modulos.m1)} | Benefícios ${fmt(res.modulos.m2)} | Insumos ${fmt(res.modulos.m3)} | Encargos ${fmt(res.modulos.m4)} (${pct(res.pctEncargos)})`,
      `Custos indiretos ${fmt(res.indiretos)} | Lucro ${fmt(res.lucro)} | Tributos ${fmt(res.tributos)} (${pct(res.pctTributos)})`,
    ].join('\n');
    const post = body => { try { fetch(url, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) }); } catch (e) { /* ignora */ } };
    const createdAt = new Date().toISOString();
    post({ type: 'lead.created', createdAt, lead: Object.assign({}, lead, {
      segment: '', employees: '', challenge: 'precificacao', message: resumo.slice(0, 1200),
      source: 'orcamento-pdf', context: 'formacao-de-preco', pageUrl: '/orcamento/', attribution: {},
    }) });
    // Cópia do PDF e dos dados da simulação em requisição separada (não interfere no registro do lead)
    try {
      const b64 = doc.output('datauristring').split(',')[1];
      post({ type: 'orcamento.pdf', createdAt, email: lead.email, name: lead.name, company: lead.company, fileName: nome, pdfBase64: b64, simulacao: inp, totais: { fatura: res.fatura, headcount: res.headcount, grupos: res.grupos } });
    } catch (e) { /* ignora */ }
  }

  // ───────────────────────── salvar contrato ─────────────────────────
  function salvarContratoDialog() {
    if (!(res.fatura > 0)) { toast('Monte o orçamento antes de salvar.'); return; }
    const c = edicao && contratos.find(x => x.id === edicao.contratoId);
    const d = document.createElement('dialog'); d.className = 'dlg';
    const ult = c ? c.versoes[c.versoes.length - 1].vigencia : null;
    d.innerHTML = `<form method="dialog" novalidate>
      <h2>${c ? 'Nova versão do orçamento' : 'Salvar contrato'}</h2>
      <p class="muted">${c ? 'Use para reajuste, repactuação ou alteração de postos. Os meses a partir da vigência passam a ser comparados com esta versão.' : 'O contrato fica salvo neste navegador para o acompanhamento mensal.'}</p>
      ${c ? '' : `<label>Nome do contrato<input name="nome" required maxlength="120" value="${esc(inp.meta.cliente ? inp.meta.cliente + ' – ' + inp.meta.servico : inp.meta.servico)}"></label>`}
      <label>Vigente a partir de<input name="vigencia" type="month" required value="${ult ? proxMes(ult) : mesAtual()}"></label>
      <p class="erro"></p>
      <div class="dlg-actions"><button type="button" class="btn ghost-dark" data-x>Cancelar</button><button class="btn primary">Salvar</button></div></form>`;
    document.body.appendChild(d); d.showModal();
    $('[data-x]', d).onclick = () => { d.close(); d.remove(); };
    $('form', d).onsubmit = ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const vig = fd.get('vigencia');
      if (!/^\d{4}-\d{2}$/.test(vig || '')) { $('.erro', d).textContent = 'Informe o mês de vigência.'; return; }
      const versao = { id: uid(), vigencia: vig, inp: clone(inp), salvoEm: new Date().toISOString() };
      if (c) {
        const ex = c.versoes.findIndex(v => v.vigencia === vig);
        if (ex >= 0) { if (!confirm('Já existe uma versão com essa vigência. Substituir?')) return; c.versoes[ex] = versao; }
        else c.versoes.push(versao);
        c.versoes.sort((a, b) => a.vigencia.localeCompare(b.vigencia));
      } else {
        const nome = (fd.get('nome') || '').trim();
        if (!nome) { $('.erro', d).textContent = 'Dê um nome ao contrato.'; return; }
        const novo = { id: uid(), nome, cliente: inp.meta.cliente, criadoEm: new Date().toISOString(), tolerancia: 0.05, versoes: [versao], meses: {} };
        contratos.push(novo);
        edicao = { contratoId: novo.id }; store.set(K.edicao, edicao);
        acomp.contratoId = novo.id;
      }
      salvarContratos(); d.close(); d.remove();
      renderResumo();
      toast('Contrato salvo. Lance os meses na aba Acompanhamento mensal.');
      evento('orcamento_contrato_salvo');
    };
  }

  // ═════════════════════════ ACOMPANHAMENTO MENSAL ═════════════════════════
  const acomp = { contratoId: null, mes: null, modo: 'pct' };
  let chart = null;

  function versaoDoMes(c, mes) {
    const vs = c.versoes.slice().sort((a, b) => a.vigencia.localeCompare(b.vigencia));
    let v = vs[0];
    vs.forEach(x => { if (x.vigencia <= mes) v = x; });
    return v;
  }
  const orcadoDoMes = (c, mes) => E.calcular(versaoDoMes(c, mes).inp);

  function dadosContrato(c) {
    const meses = Object.keys(c.meses).sort();
    const comps = meses.map(m => ({ mes: m, reg: c.meses[m], orc: orcadoDoMes(c, m), cmp: null }));
    comps.forEach(x => { x.cmp = E.compararMes(x.orc, x.reg.real || {}, c.tolerancia); });
    const varia = E.variacaoMesAMes(meses.map(m => ({ mes: m, real: c.meses[m].real, headcount: c.meses[m].headcount })));
    const acum = comps.reduce((a, x) => {
      if (x.cmp.custoReal !== null) { a.orc += x.cmp.custoOrc; a.real += x.cmp.custoReal; }
      if (x.cmp.fatReal !== null && x.cmp.custoReal !== null) { a.fat += x.cmp.fatReal; a.res += x.cmp.resultadoReal; a.fatOrc += x.cmp.fatOrc; a.resOrc += x.cmp.resultadoOrc; }
      return a;
    }, { orc: 0, real: 0, fat: 0, res: 0, fatOrc: 0, resOrc: 0 });
    return { meses, comps, varia, acum };
  }

  function renderAcomp() {
    const box = $('#acomp');
    if (!contratos.length) {
      box.innerHTML = `<div class="panel empty" style="margin-top:22px"><h3>Nenhum contrato salvo ainda</h3>
        <p>Monte o orçamento na aba Formação de preço e clique em “Salvar como contrato para acompanhar”. Para ver como funciona, carregue um exemplo com seis meses lançados.</p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px"><button class="btn primary" data-a="ir-preco">Montar orçamento</button><button class="btn ghost-dark" data-a="exemplo">Carregar exemplo</button></div></div>`;
      return;
    }
    if (!contratos.find(c => c.id === acomp.contratoId)) acomp.contratoId = contratos[0].id;
    const c = contratos.find(x => x.id === acomp.contratoId);
    const D = dadosContrato(c);
    if (!acomp.mes) acomp.mes = D.meses.length ? proxMes(D.meses[D.meses.length - 1]) : (c.versoes[0].vigencia || mesAtual());
    const orcAtual = orcadoDoMes(c, acomp.mes);
    const ultimo = D.varia[D.varia.length - 1];
    const desvAc = D.acum.orc ? (D.acum.real - D.acum.orc) / D.acum.orc : null;
    const margReal = D.acum.fat ? D.acum.res / D.acum.fat : null;
    const margOrc = D.acum.fatOrc ? D.acum.resOrc / D.acum.fatOrc : (orcAtual.fatura ? (orcAtual.fatura - custoOrcGrupos(orcAtual)) / orcAtual.fatura : 0);

    box.innerHTML = `
      <div class="acomp-top">
        <label>Contrato<select data-a="contrato">${contratos.map(x => `<option value="${x.id}"${x.id === c.id ? ' selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
        <label style="min-width:160px">Tolerância de desvio<span class="suffix" data-suf="%"><input data-a="tol" inputmode="decimal" value="${numBR(c.tolerancia * 100, 2)}"></span></label>
        <button class="btn ghost-dark" data-a="nova-versao">Nova versão do orçamento (reajuste)</button>
        <button class="btn primary" data-a="pdf-rel" ${D.meses.length ? '' : 'disabled'}>Relatório em PDF</button>
      </div>

      <div class="kpi-row">
        <div class="kpi-card"><span>Fatura orçada vigente (${mesLabel(acomp.mes)})</span><b>${fmt(orcAtual.fatura)}</b><small>Custo orçado ${fmt(custoOrcGrupos(orcAtual))} · ${c.versoes.length} versão(ões)</small></div>
        <div class="kpi-card"><span>Custo acumulado realizado x orçado</span><b class="${desvAc > c.tolerancia ? 'up' : desvAc > 0 ? '' : 'down'}">${desvAc === null ? '–' : (desvAc > 0 ? '+' : '') + pct(desvAc, 1)}</b><small>${fmt(D.acum.real)} realizado / ${fmt(D.acum.orc)} orçado</small></div>
        <div class="kpi-card"><span>Margem realizada acumulada</span><b>${margReal === null ? '–' : pct(margReal, 1)}</b><small>Orçada: ${pct(margOrc, 1)} (antes de tributos sobre lucro)</small></div>
        <div class="kpi-card"><span>Resultado do último mês</span><b class="${ultimo && ultimo.resultado.valor !== null ? (ultimo.resultado.valor < 0 ? 'prej' : 'lucro') : ''}">${ultimo && ultimo.resultado.valor !== null ? fmt(ultimo.resultado.valor) : '–'}</b><small>${ultimo && ultimo.resultado.valor !== null ? mesLabel(ultimo.mes) + ' · margem ' + pct(ultimo.margem.valor, 1) + (ultimo.resultado.delta !== null ? ' · ' + (ultimo.resultado.delta >= 0 ? '+' : '') + fmt(ultimo.resultado.delta) + ' x mês anterior' : '') : 'informe faturamento e custos'}</small></div>
        <div class="kpi-card"><span>Custo do último mês x anterior</span><b class="${dCls(ultimo && ultimo.custoTotal.deltaPct, true)}">${ultimo && ultimo.custoTotal.deltaPct !== null ? sinal(ultimo.custoTotal.deltaPct) : '–'}</b><small>${ultimo ? mesLabel(ultimo.mes) + ': ' + fmt(ultimo.custoTotal.valor) : 'sem lançamentos'}</small></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Lançar custos realizados</h2>
          <label style="flex-direction:row;align-items:center;gap:8px">Competência <input type="month" data-a="mes" value="${acomp.mes}" style="width:auto"></label></div>
        <p class="muted">Use os valores do mês: folha e encargos do DP, notas e recibos dos insumos, guias de tributos e a nota fiscal emitida. Orçamento comparado: versão vigente desde ${mesLabel(versaoDoMes(c, acomp.mes).vigencia)}.</p>
        ${formLancamento(c, orcAtual)}
      </div>

      ${D.meses.length ? `
      <div class="panel">
        <div class="panel-head"><h2>Variação mês a mês: custos e resultado do contrato</h2>
          <div class="seg" role="group" aria-label="Exibição" style="margin:0">
            <button type="button" data-a="modo" data-m="pct" aria-pressed="${acomp.modo === 'pct'}">Δ %</button>
            <button type="button" data-a="modo" data-m="rs" aria-pressed="${acomp.modo === 'rs'}">Δ R$</button>
            <button type="button" data-a="modo" data-m="val" aria-pressed="${acomp.modo === 'val'}">Valores</button>
          </div></div>
        <p class="muted">Compara cada custo com o mês anterior lançado. Vermelho: o custo subiu acima da tolerância; verde: caiu. O custo por funcionário separa o efeito do número de pessoas do efeito do preço. O resultado é o faturamento menos os custos realizados lançados: verde é lucro, vermelho é prejuízo.</p>
        <div class="tbl-wrap">${tabelaVariacao(D, c)}</div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Orçado x realizado por competência</h2></div>
        <div class="tbl-wrap">${tabelaCompetencias(D)}</div>
        <div class="chart-box" style="margin-top:16px"><canvas id="chart-acomp" aria-label="Gráfico de custo orçado e realizado por mês"></canvas></div>
      </div>

      ${detalheMes(c, D)}` : ''}`;
    desenharGrafico(D);
    atualizarLancamento();
  }
  const custoOrcGrupos = r => E.GRUPOS.reduce((a, g) => a + r.grupos[g.k], 0);
  const sinal = v => (v > 0 ? '+' : '') + pct(v, 1);
  function dCls(v, custo) { if (v === null || v === undefined || Math.abs(v) < 0.0005) return 'flat'; return (v > 0) === custo ? 'up' : 'down'; }

  // cfg salvo no mês; meses antigos (sem cfg) foram lançados com valores digitados
  function cfgDoReg(reg, orc) { return reg ? (reg.cfg || { encargos: 'valor', indiretos: 'valor', tributos: 'valor' }) : E.CFG_PADRAO(orc); }
  function formLancamento(c, orc) {
    const reg = c.meses[acomp.mes];
    const cfg = Object.assign(E.CFG_PADRAO(orc), cfgDoReg(reg, orc));
    const ent = reg ? (reg.entrada || reg.real || {}) : {};
    const real = reg ? reg.real || {} : {};
    const ro = k => (k === 'encargos' && cfg.encargos === 'auto') || (k === 'indiretos' && cfg.indiretos === 'pct') || (k === 'tributos' && cfg.tributos === 'pct');
    const val = k => { const v = ro(k) ? real[k] : ent[k]; return v === undefined || v === null || v === '' ? '' : numBR(v, 2); };
    const insumosV = versaoDoMes(c, acomp.mes).inp.insumos.map(x => x.desc).filter(Boolean);
    const dica = g => g.k === 'insumos' && insumosV.length ? `Valores referentes a: ${insumosV.join(', ')}.` : g.dica;
    const modo = {
      encargos: `<select data-cfg="encargos" aria-label="Como calcular os encargos"><option value="auto"${cfg.encargos === 'auto' ? ' selected' : ''}>Automático: ${pct(orc.pctEncargos)} da remuneração</option><option value="valor"${cfg.encargos !== 'auto' ? ' selected' : ''}>Informar o valor real</option></select>`,
      indiretos: `<div class="lanc-modo"><select data-cfg="indiretos" aria-label="Como informar os custos indiretos"><option value="pct"${cfg.indiretos === 'pct' ? ' selected' : ''}>% sobre os custos diretos do mês</option><option value="valor"${cfg.indiretos !== 'pct' ? ' selected' : ''}>Informar o valor em R$</option></select>
        <span class="suffix" data-suf="%" data-cfgbox="indiretos"${cfg.indiretos === 'pct' ? '' : ' hidden'}><input inputmode="decimal" data-cfgpct="indiretosPct" value="${numBR(cfg.indiretosPct * 100, 4)}" aria-label="Percentual de custos indiretos"></span></div>`,
      tributos: `<div class="lanc-modo"><select data-cfg="tributos" aria-label="Como informar os tributos"><option value="pct"${cfg.tributos === 'pct' ? ' selected' : ''}>Alíquota sobre o faturamento</option><option value="valor"${cfg.tributos !== 'pct' ? ' selected' : ''}>Informar o valor da guia</option></select>
        <span class="suffix" data-suf="%" data-cfgbox="tributos"${cfg.tributos === 'pct' ? '' : ' hidden'}><input inputmode="decimal" data-cfgpct="tributosPct" value="${numBR(cfg.tributosPct * 100, 4)}" aria-label="Alíquota de tributos"></span></div>`,
    };
    const campoG = g => `<div class="lanc-item"><b>${esc(g.label)}</b><small class="dica">${esc(dica(g))}</small>${modo[g.k] || ''}
        <span class="prefix"><input inputmode="decimal" data-ent="${g.k}" value="${val(g.k)}" placeholder="${numBR(orc.grupos[g.k], 2)}"${ro(g.k) ? ' readonly tabindex="-1"' : ''} aria-label="${esc(g.label)}"></span><span class="orc">Orçado: ${fmt(orc.grupos[g.k])}</span></div>`;
    return `<div class="lanc-grid">
        <div class="lanc-item"><b>Faturamento emitido</b><small class="dica">Valor bruto da nota fiscal do mês, antes das retenções.</small><span class="prefix"><input inputmode="decimal" data-ent="faturamento" value="${val('faturamento')}" placeholder="${numBR(orc.fatura, 2)}" aria-label="Faturamento emitido"></span><span class="orc">Orçado: ${fmt(orc.fatura)}</span></div>
        ${E.GRUPOS.map(campoG).join('')}
        <div class="lanc-item"><b>Funcionários no mês</b><small class="dica">Pessoas que trabalharam no contrato no mês, incluindo coberturas.</small><input inputmode="numeric" data-hc value="${reg && reg.headcount != null ? reg.headcount : ''}" aria-label="Funcionários no mês"><span class="orc">Orçado: ${numBR(orc.headcount, 0)}</span></div>
      </div>
      <div class="lanc-res" data-lanc-res></div>
      <label style="margin-top:12px">Observações do mês (faltas, coberturas, horas extras, reajuste)<textarea data-obs rows="2" maxlength="800">${esc(reg ? reg.obs || '' : '')}</textarea></label>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
        <button class="btn primary" data-a="salvar-mes">Salvar ${mesLabel(acomp.mes)}</button>
        <button class="btn ghost-dark" data-a="copiar-orc">Preencher vazios com o orçado</button>
        ${reg ? '<button class="btn danger" data-a="excluir-mes">Excluir competência</button>' : ''}
      </div>`;
  }
  // Lê o formulário de lançamento e monta os valores realizados (com os campos automáticos)
  function lerLancamento(orc) {
    const entrada = {}, cfg = {};
    $$('[data-cfg]', ac).forEach(el => { cfg[el.dataset.cfg] = el.value; });
    $$('[data-cfgpct]', ac).forEach(i => { cfg[i.dataset.cfgpct] = parseNum(i.value) / 100; });
    $$('[data-ent]', ac).forEach(i => { if (!i.readOnly && i.value.trim() !== '') entrada[i.dataset.ent] = parseNum(i.value); });
    return { entrada, cfg, real: E.resolverRealizado(entrada, cfg, orc) };
  }
  function atualizarLancamento() {
    const c = contratos.find(x => x.id === acomp.contratoId); if (!c || !$('[data-lanc-res]', ac)) return;
    const orc = orcadoDoMes(c, acomp.mes);
    ['encargos', 'indiretos', 'tributos'].forEach(k => {
      const sel = $(`[data-cfg="${k}"]`, ac), i = $(`[data-ent="${k}"]`, ac), box = $(`[data-cfgbox="${k}"]`, ac);
      const auto = sel.value === 'auto' || sel.value === 'pct';
      if (i.readOnly && !auto) i.value = '';
      i.readOnly = auto; i.tabIndex = auto ? -1 : 0;
      if (box) box.hidden = !auto;
    });
    const L = lerLancamento(orc);
    ['encargos', 'indiretos', 'tributos'].forEach(k => { const i = $(`[data-ent="${k}"]`, ac); if (i.readOnly) i.value = L.real[k] != null ? numBR(L.real[k], 2) : ''; });
    const custos = E.GRUPOS.filter(g => L.real[g.k] != null);
    const custo = custos.reduce((a, g) => a + L.real[g.k], 0);
    const box = $('[data-lanc-res]', ac);
    if (!custos.length) { box.innerHTML = ''; return; }
    const fat = L.real.faturamento;
    const resv = fat != null ? fat - custo : null;
    box.innerHTML = `<span>Custo realizado: <b>${fmt(custo)}</b>${custos.length < E.GRUPOS.length ? ` <small>(${custos.length} de ${E.GRUPOS.length} grupos)</small>` : ''}</span>`
      + (resv === null ? '<span>Informe o faturamento para ver o resultado.</span>'
        : `<span>Resultado do mês: <b class="${resv < 0 ? 'prej' : 'lucro'}">${resv < 0 ? 'prejuízo de ' : 'lucro de '}${fmt(Math.abs(resv))}</b> · margem ${fat ? pct(resv / fat, 1) : '–'}</span>`);
  }

  function tabelaVariacao(D, c) {
    const V = D.varia;
    const tol = c.tolerancia;
    const linhas = E.GRUPOS.map(g => ({ label: g.label, get: x => x.grupos[g.k], custo: true }))
      .concat([{ label: 'Custo total realizado', get: x => x.custoTotal, custo: true, tot: true },
        { label: 'Custo por funcionário', get: x => x.custoPorFuncionario, custo: true },
        { label: 'Faturamento', get: x => x.faturamento, custo: false }]);
    const head = `<tr><th>Item</th>${V.map(x => `<th>${mesLabel(x.mes)}</th>`).join('')}</tr>`;
    const cell = (d, custo) => {
      if (!d || d.valor === null) return '<td class="flat">–</td>';
      if (acomp.modo === 'val') return `<td>${fmt(d.valor)}</td>`;
      if (d.deltaPct === null && d.delta === null) return `<td class="flat" title="${fmt(d.valor)}">base</td>`;
      const cls = dCls(d.deltaPct, custo);
      const heat = d.deltaPct === null ? '' : (custo ? d.deltaPct : -d.deltaPct) > tol ? 'heat-bad' : (custo ? d.deltaPct : -d.deltaPct) < -tol ? 'heat-ok' : '';
      const txt = acomp.modo === 'pct' ? (d.deltaPct === null ? '–' : sinal(d.deltaPct)) : ((d.delta > 0 ? '+' : '') + fmt(d.delta));
      return `<td class="${cls} ${heat}" title="${fmt(d.anterior)} → ${fmt(d.valor)}">${txt}</td>`;
    };
    // Resultado (lucro ou prejuízo): mostra sempre o valor, com a variação embaixo
    const celRes = d => {
      if (!d || d.valor === null) return '<td class="flat">–</td>';
      const var_ = acomp.modo === 'val' || d.delta === null ? '' : `<small class="${d.delta >= 0 ? 'down' : 'up'}">${acomp.modo === 'pct' && d.deltaPct !== null ? sinal(d.deltaPct) : (d.delta > 0 ? '+' : '') + fmt(d.delta)}</small>`;
      return `<td class="${d.valor < 0 ? 'prej' : 'lucro'}" title="${d.anterior === null ? '' : fmt(d.anterior) + ' → '}${fmt(d.valor)}"><b>${fmt(d.valor)}</b>${var_}</td>`;
    };
    const celMarg = d => {
      if (!d || d.valor === null) return '<td class="flat">–</td>';
      const pp = d.delta === null || acomp.modo === 'val' ? '' : `<small class="${d.delta >= 0 ? 'down' : 'up'}">${d.delta > 0 ? '+' : ''}${numBR(d.delta * 100, 1)} p.p.</small>`;
      return `<td class="${d.valor < 0 ? 'prej' : 'lucro'}">${pct(d.valor, 1)}${pp}</td>`;
    };
    const body = linhas.map(l => `<tr class="${l.tot ? 'tot' : ''}"><td>${esc(l.label)}</td>${V.map(x => cell(l.get(x), l.custo)).join('')}</tr>`).join('')
      + `<tr class="res"><td>Resultado do contrato (lucro ou prejuízo)</td>${V.map(x => celRes(x.resultado)).join('')}</tr>`
      + `<tr class="res-m"><td>Margem do resultado (% do faturamento)</td>${V.map(x => celMarg(x.margem)).join('')}</tr>`
      + `<tr><td>Funcionários</td>${V.map(x => `<td>${x.headcount == null ? '–' : numBR(x.headcount, 0)}</td>`).join('')}</tr>`;
    return `<table class="rep">${head}${body}</table>`;
  }

  function tabelaCompetencias(D) {
    const rows = D.comps.map(x => {
      const k = x.cmp;
      return `<tr class="click${x.mes === acomp.mes ? ' sel' : ''}" data-a="sel-mes" data-mes="${x.mes}">
        <td>${mesLabel(x.mes)}</td><td>${k.fatReal === null ? '–' : fmt(k.fatReal)}</td><td>${fmt(k.custoOrc)}</td>
        <td>${k.custoReal === null ? '–' : fmt(k.custoReal)}</td>
        <td class="${dCls(k.desvioCustoPct, true)}">${k.desvioCusto === null ? '–' : (k.desvioCusto > 0 ? '+' : '') + fmt(k.desvioCusto)}</td>
        <td class="${dCls(k.desvioCustoPct, true)}">${k.desvioCustoPct === null ? '–' : sinal(k.desvioCustoPct)}</td>
        <td>${pct(k.margemOrcPct, 1)}</td><td>${k.margemRealPct === null ? '–' : pct(k.margemRealPct, 1)}</td>
        <td>${chip(k.status)}${k.completo ? '' : ' <span class="chip pendente" title="Nem todos os grupos foram lançados; os vazios contam pelo orçado">parcial</span>'}</td></tr>`;
    }).join('');
    return `<table class="rep"><tr><th>Competência</th><th>Faturamento</th><th>Custo orçado</th><th>Custo realizado</th><th>Desvio R$</th><th>Desvio %</th><th>Margem orçada</th><th>Margem real</th><th>Situação</th></tr>${rows}</table>`;
  }
  function chip(s) { return `<span class="chip ${s}">${{ ok: 'Dentro', atencao: 'Na tolerância', estouro: 'Acima', pendente: 'Pendente' }[s]}</span>`; }

  function detalheMes(c, D) {
    const x = D.comps.find(k => k.mes === acomp.mes);
    if (!x) return '';
    const v = D.varia.find(k => k.mes === acomp.mes);
    const rows = x.cmp.linhas.map(l => {
      const mm = v.grupos[l.k];
      return `<tr><td>${esc(l.label)}</td><td>${fmt(l.orcado)}</td><td>${l.real === null ? '–' : fmt(l.real)}</td>
        <td class="${dCls(l.desvioPct, true)}">${l.desvio === null ? '–' : (l.desvio > 0 ? '+' : '') + fmt(l.desvio)}</td>
        <td class="${dCls(l.desvioPct, true)}">${l.desvioPct === null ? '–' : sinal(l.desvioPct)}</td>
        <td>${chip(l.status)}</td>
        <td class="${dCls(mm.deltaPct, true)}">${mm.deltaPct === null ? '–' : sinal(mm.deltaPct)}</td></tr>`;
    }).join('');
    const k = x.cmp;
    return `<div class="panel"><div class="panel-head"><h2>Detalhe de ${mesLabel(acomp.mes)}</h2>${chip(k.status)}</div>
      <div class="tbl-wrap"><table class="rep"><tr><th>Grupo</th><th>Orçado</th><th>Realizado</th><th>Desvio R$</th><th>Desvio %</th><th>Situação</th><th>x mês anterior</th></tr>${rows}
      <tr class="tot"><td>Custo total</td><td>${fmt(k.custoOrc)}</td><td>${k.custoReal === null ? '–' : fmt(k.custoReal)}</td><td>${k.desvioCusto === null ? '–' : fmt(k.desvioCusto)}</td><td>${k.desvioCustoPct === null ? '–' : sinal(k.desvioCustoPct)}</td><td></td><td class="${dCls(v.custoTotal.deltaPct, true)}">${v.custoTotal.deltaPct === null ? '–' : sinal(v.custoTotal.deltaPct)}</td></tr>
      <tr><td>Faturamento</td><td>${fmt(k.fatOrc)}</td><td>${k.fatReal === null ? '–' : fmt(k.fatReal)}</td><td>${k.fatReal === null ? '–' : fmt(k.fatReal - k.fatOrc)}</td><td></td><td></td><td class="${dCls(v.faturamento.deltaPct, false)}">${v.faturamento.deltaPct === null ? '–' : sinal(v.faturamento.deltaPct)}</td></tr>
      <tr class="tot"><td>Resultado do contrato</td><td>${fmt(k.resultadoOrc)}</td><td>${k.resultadoReal === null ? '–' : fmt(k.resultadoReal)}</td><td>${k.resultadoReal === null ? '–' : fmt(k.resultadoReal - k.resultadoOrc)}</td><td></td><td></td><td></td></tr></table></div>
      ${x.reg.obs ? `<p class="note">${esc(x.reg.obs)}</p>` : ''}</div>`;
  }

  function desenharGrafico(D) {
    const cv = $('#chart-acomp'); if (!cv || !window.Chart) return;
    if (chart) chart.destroy();
    const css = getComputedStyle(document.documentElement);
    chart = new Chart(cv, {
      data: {
        labels: D.comps.map(x => mesLabel(x.mes)),
        datasets: [
          { type: 'bar', label: 'Custo orçado', data: D.comps.map(x => x.cmp.custoOrc), backgroundColor: '#c9d3ce', borderRadius: 4, yAxisID: 'y' },
          { type: 'bar', label: 'Custo realizado', data: D.comps.map(x => x.cmp.custoReal), backgroundColor: D.comps.map(x => ({ estouro: css.getPropertyValue('--bad'), atencao: css.getPropertyValue('--warn') }[x.cmp.status] || css.getPropertyValue('--brand'))), borderRadius: 4, yAxisID: 'y' },
          { type: 'line', label: 'Margem real', data: D.comps.map(x => x.cmp.margemRealPct === null ? null : x.cmp.margemRealPct * 100), borderColor: '#14110a', backgroundColor: '#14110a', tension: .3, yAxisID: 'y2', spanGaps: true },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { font: { family: 'Montserrat' } } },
          tooltip: { callbacks: { label: ctx => ctx.dataset.yAxisID === 'y2' ? `${ctx.dataset.label}: ${numBR(ctx.raw, 1)}%` : `${ctx.dataset.label}: ${fmt(ctx.raw)}` } } },
        scales: { y: { ticks: { callback: v => money0(v) }, grid: { color: '#eef1ef' } },
          y2: { position: 'right', grid: { display: false }, ticks: { callback: v => v + '%' } }, x: { grid: { display: false } } },
      },
    });
  }

  // eventos do acompanhamento
  const ac = $('#acomp');
  ac.addEventListener('click', ev => {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const c = contratos.find(x => x.id === acomp.contratoId);
    const a = b.dataset.a;
    if (a === 'ir-preco') abrirAba('preco');
    if (a === 'exemplo') { criarExemplo(); renderAcomp(); toast('Exemplo carregado: seis meses de um contrato de portaria.'); }
    if (a === 'modo') { acomp.modo = b.dataset.m; renderAcomp(); }
    if (a === 'sel-mes') { acomp.mes = b.dataset.mes; renderAcomp(); }
    if (a === 'salvar-mes') salvarMes(c);
    if (a === 'copiar-orc') {
      const orc = orcadoDoMes(c, acomp.mes);
      $$('[data-ent]', ac).forEach(i => { if (!i.value && !i.readOnly) i.value = numBR(i.dataset.ent === 'faturamento' ? orc.fatura : orc.grupos[i.dataset.ent], 2); });
      const hc = $('[data-hc]', ac); if (!hc.value) hc.value = orc.headcount;
      atualizarLancamento();
    }
    if (a === 'excluir-mes') { if (confirm(`Excluir os lançamentos de ${mesLabel(acomp.mes)}?`)) { delete c.meses[acomp.mes]; salvarContratos(); renderAcomp(); } }
    if (a === 'nova-versao') {
      const v = c.versoes[c.versoes.length - 1];
      inp = clone(v.inp); edicao = { contratoId: c.id }; store.set(K.edicao, edicao);
      abrirAba('preco'); renderForm();
      toast('Ajuste o orçamento e clique em “Salvar nova versão”.');
    }
    if (a === 'pdf-rel') {
      if (!window.StarqiaPDF) { toast('O gerador de PDF não carregou.'); return; }
      const D = dadosContrato(c);
      const docR = window.StarqiaPDF.relatorio(c, D, { orcadoDoMes: m => orcadoDoMes(c, m), versaoDoMes: m => versaoDoMes(c, m) });
      const nomeR = `Acompanhamento_${nomeArquivo(c.nome)}_${new Date().toISOString().slice(0, 10)}.pdf`;
      docR.save(nomeR); salvarPdfNuvem(docR, nomeR);
    }
  });
  ac.addEventListener('change', ev => {
    const el = ev.target; const a = el.dataset.a;
    const c = contratos.find(x => x.id === acomp.contratoId);
    if (a === 'contrato') { acomp.contratoId = el.value; acomp.mes = null; renderAcomp(); }
    if (a === 'mes' && el.value) { acomp.mes = el.value; renderAcomp(); }
    if (el.dataset.cfg) atualizarLancamento();
    if ((el.dataset.ent || el.dataset.cfgpct) && !el.readOnly && el.value.trim() !== '') el.value = numBR(parseNum(el.value), el.dataset.cfgpct ? 4 : 2);
    if (a === 'tol') { c.tolerancia = Math.max(0, parseNum(el.value) / 100); salvarContratos(); renderAcomp(); }
  });

  ac.addEventListener('input', ev => { if (ev.target.dataset.ent || ev.target.dataset.cfgpct) atualizarLancamento(); });

  function salvarMes(c) {
    const L = lerLancamento(orcadoDoMes(c, acomp.mes));
    if (!Object.keys(L.real).length) { toast('Informe ao menos um valor realizado.'); return; }
    const hcv = $('[data-hc]', ac).value.trim();
    c.meses[acomp.mes] = { real: L.real, entrada: L.entrada, cfg: L.cfg, headcount: hcv === '' ? null : parseNum(hcv), obs: $('[data-obs]', ac).value.trim(), salvoEm: new Date().toISOString() };
    salvarContratos();
    toast(`${mesLabel(acomp.mes)} salvo.`);
    evento('orcamento_mes_lancado');
    renderAcomp();
  }

  function criarExemplo() {
    const base = E.modeloPadrao('portaria');
    base.meta.cliente = 'Condomínio Exemplo'; base.meta.proposta = 'EX-001';
    const r = E.calcular(base);
    const fat = {
      remuneracao: [1, 1.01, 1.04, 0.99, 1.07, 1.02], beneficios: [1, 1, 1.02, 1.02, 1.03, 1.03], insumos: [1.4, 0.8, 0.9, 1.1, 0.7, 1.5],
      encargos: [1, 1.01, 1.04, 0.99, 1.06, 1.02], indiretos: [1, 1, 1.05, 1, 1.1, 1.02], tributos: [1, 1, 1, 1, 1, 1],
    };
    const c = { id: uid(), nome: 'Condomínio Exemplo – Portaria 12x36', cliente: 'Condomínio Exemplo', criadoEm: new Date().toISOString(), tolerancia: 0.05,
      versoes: [{ id: uid(), vigencia: '2026-05', inp: base, salvoEm: new Date().toISOString() }], meses: {} };
    ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].forEach((m, i) => {
      const entrada = { faturamento: E.r2(r.fatura) };
      ['remuneracao', 'beneficios', 'insumos'].forEach(k => { entrada[k] = E.r2(r.grupos[k] * fat[k][i]); });
      const cfg = E.CFG_PADRAO(r);
      if (i === 4) { cfg.indiretos = 'valor'; entrada.indiretos = E.r2(r.grupos.indiretos * 1.1); }
      const real = E.resolverRealizado(entrada, cfg, r);
      c.meses[m] = { real, entrada, cfg, headcount: i === 4 ? 5 : 4, obs: i === 4 ? 'Cobertura de férias com folguista extra e horas extras no feriado.' : '' };
    });
    contratos.push(c); salvarContratos();
    acomp.contratoId = c.id; acomp.mes = null; // abre no próximo mês sem lançamento
  }

  // ═════════════════════════ CONTRATOS ═════════════════════════
  function renderContratos() {
    const box = $('#contratos');
    const lista = contratos.map(c => {
      const meses = Object.keys(c.meses).sort();
      const v = c.versoes[c.versoes.length - 1];
      const r = E.calcular(v.inp);
      return `<div class="card contrato" style="padding:16px 18px"><div><h3>${esc(c.nome)}</h3>
        <div class="meta">Fatura vigente ${fmt(r.fatura)} · ${r.headcount} funcionário(s) · ${c.versoes.length} versão(ões) · ${meses.length ? meses.length + ' mês(es) lançados, último ' + mesLabel(meses[meses.length - 1]) : 'sem lançamentos'}</div></div>
        <div class="acts"><button class="btn primary sm" data-c="acomp" data-id="${c.id}">Acompanhar</button>
        <button class="btn ghost-dark sm" data-c="editar" data-id="${c.id}">Editar orçamento</button>
        <button class="btn ghost-dark sm" data-c="renomear" data-id="${c.id}">Renomear</button>
        <button class="btn ghost-dark sm" data-c="duplicar" data-id="${c.id}">Duplicar</button>
        <button class="btn danger sm" data-c="excluir" data-id="${c.id}">Excluir</button></div></div>`;
    }).join('');
    box.innerHTML = `<div class="lista">
      <div style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn primary" data-c="backup">Exportar backup (.json)</button>
        <label class="btn ghost-dark" style="flex-direction:row;font-size:13.5px;color:var(--ink-900)">Importar backup<input type="file" accept="application/json,.json" data-c="importar" hidden></label></div>
      ${lista || '<div class="panel empty"><h3>Nenhum contrato salvo</h3><p>Salve um orçamento na aba Formação de preço para começar.</p></div>'}</div>`;
  }
  const ct = $('#contratos');
  ct.addEventListener('click', ev => {
    const b = ev.target.closest('[data-c]'); if (!b || b.tagName === 'INPUT') return;
    const c = contratos.find(x => x.id === b.dataset.id);
    const a = b.dataset.c;
    if (a === 'acomp') { acomp.contratoId = c.id; acomp.mes = null; abrirAba('acomp'); }
    if (a === 'editar') { inp = clone(c.versoes[c.versoes.length - 1].inp); edicao = { contratoId: c.id }; store.set(K.edicao, edicao); abrirAba('preco'); renderForm(); }
    if (a === 'renomear') { const n = prompt('Novo nome do contrato:', c.nome); if (n && n.trim()) { c.nome = n.trim().slice(0, 120); salvarContratos(); renderContratos(); } }
    if (a === 'duplicar') { const d = clone(c); d.id = uid(); d.nome = c.nome + ' (cópia)'; d.meses = {}; d.criadoEm = new Date().toISOString(); contratos.push(d); salvarContratos(); renderContratos(); }
    if (a === 'excluir') { if (confirm(`Excluir “${c.nome}” e todos os meses lançados? Exporte um backup antes, se precisar.`)) { contratos = contratos.filter(x => x !== c); registrarExclusao(c.id); salvarContratos(); if (edicao && edicao.contratoId === c.id) { edicao = null; store.del(K.edicao); } renderContratos(); } }
    if (a === 'backup') {
      const blob = new Blob([JSON.stringify({ app: 'starqia-orcamento', versao: 1, exportadoEm: new Date().toISOString(), contratos }, null, 2)], { type: 'application/json' });
      const u = URL.createObjectURL(blob); const l = document.createElement('a'); l.href = u; l.download = `starqia-contratos-${new Date().toISOString().slice(0, 10)}.json`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
    }
  });
  ct.addEventListener('change', ev => {
    const el = ev.target; if (el.dataset.c !== 'importar' || !el.files[0]) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(fr.result);
        if (!d || !Array.isArray(d.contratos)) throw new Error('formato');
        const validos = d.contratos.filter(c => c && c.id && c.nome && Array.isArray(c.versoes) && c.versoes.length && c.meses && typeof c.meses === 'object');
        let novos = 0, subst = 0;
        validos.forEach(c => { const i = contratos.findIndex(x => x.id === c.id); if (i >= 0) { contratos[i] = c; subst++; } else { contratos.push(c); novos++; } });
        salvarContratos(); renderContratos();
        toast(`Backup importado: ${novos} novo(s), ${subst} atualizado(s).`);
      } catch (e) { toast('Arquivo inválido. Use um backup exportado por este sistema.'); }
    };
    fr.readAsText(el.files[0]);
  });

  // ═════════════════════════ início ═════════════════════════
  renderForm();
  const h = (location.hash || '').replace('#', '');
  if (['preco', 'acomp', 'contratos'].includes(h)) abrirAba(h);
  evento('visita');
  iniciarNuvem();
})();
