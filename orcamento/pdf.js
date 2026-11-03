/* STARQIA.GCOS – geração de PDF (proposta de formação de preço e relatório de acompanhamento) */
(function () {
  'use strict';
  const E = window.StarqiaEngine;
  const fmt = E.fmt, pct = E.pct;
  const INK = [13, 11, 5], BRAND = [0, 170, 79], STEEL = [102, 113, 107], MIST = [244, 246, 245];
  const EMPRESA = 'STARQIA SOLUÇÕES CONTÁBEIS LTDA. · CNPJ 29.552.188/0001-62 · CRC 2SP 040.629/O-7 · gcos.starqia.com';
  const mesLabel = m => { const [y, mo] = m.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+mo - 1] + '/' + y; };
  const dataBR = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return d ? `${d}/${m}/${y}` : s; };

  function novoDoc(orientacao) {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit: 'mm', format: 'a4', orientation: orientacao || 'portrait' });
  }

  function cabecalho(doc, titulo, subtitulo) {
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(...INK); doc.rect(0, 0, W, 26, 'F');
    // escudo
    doc.setFillColor(...BRAND); doc.roundedRect(12, 7, 9, 11, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(255, 255, 255);
    doc.text('STARQIA', 24, 13.5);
    doc.setTextColor(...BRAND); doc.text('.GCOS', 24 + doc.getTextWidth('STARQIA'), 13.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(200, 205, 202);
    doc.text('Inteligência contábil para quem opera segurança', 24, 18.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 255, 255);
    doc.text(titulo, W - 12, 13, { align: 'right' });
    if (subtitulo) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(200, 205, 202); doc.text(subtitulo, W - 12, 18.5, { align: 'right' }); }
    doc.setTextColor(...INK);
    return 34;
  }

  function rodapes(doc, nota) {
    const n = doc.getNumberOfPages();
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setDrawColor(223, 228, 225); doc.line(12, H - 14, W - 12, H - 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...STEEL);
      doc.text(EMPRESA, 12, H - 9.5);
      if (nota) doc.text(nota, 12, H - 6);
      doc.text(`Página ${i} de ${n}`, W - 12, H - 9.5, { align: 'right' });
    }
  }

  function titulo(doc, y, txt) {
    if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK);
    doc.setFillColor(...BRAND); doc.rect(12, y - 3.6, 1.6, 4.6, 'F');
    doc.text(txt.toUpperCase(), 16, y);
    return y + 3;
  }

  const tabelaBase = {
    theme: 'grid', margin: { left: 12, right: 12 },
    styles: { font: 'helvetica', fontSize: 8.2, cellPadding: 1.8, lineColor: [223, 228, 225], lineWidth: 0.2, textColor: INK },
    headStyles: { fillColor: MIST, textColor: [79, 88, 83], fontStyle: 'bold', fontSize: 7.6 },
  };
  // Helvetica padrão (WinAnsi) não tem alguns caracteres Unicode
  const limpa = s => typeof s === 'string' ? s.replace(/−/g, '-').replace(/→/g, '->').replace(/[  ]/g, ' ') : s;
  const limpaCel = c => (c && typeof c === 'object') ? Object.assign({}, c, { content: limpa(c.content) }) : limpa(c);
  function tabela(doc, y, head, body, opts) {
    body = body.map(r => r.map(limpaCel)); head = head.map(limpaCel);
    doc.autoTable(Object.assign({}, tabelaBase, { startY: y, head: [head], body }, opts || {}));
    return doc.lastAutoTable.finalY + 7;
  }
  const dir = { halign: 'right' };

  // ─────────────────────── PROPOSTA ───────────────────────
  function proposta(inp, r, lead) {
    const doc = novoDoc();
    const W = doc.internal.pageSize.getWidth();
    const m = inp.meta;
    let y = cabecalho(doc, 'PROPOSTA · FORMAÇÃO DE PREÇO', `${m.proposta ? 'Nº ' + m.proposta + ' · ' : ''}${dataBR(m.data)}`);

    // Identificação
    const regime = inp.regime === 'simples' ? `Simples Nacional, Anexo ${inp.simples.anexo}` : 'Lucro Presumido';
    const validade = m.validadeDias ? `${m.validadeDias} dias` : '-';
    y = tabela(doc, y, ['Identificação', ''], [
      ['Cliente / tomador', m.cliente || '-'], ['Serviço', m.servico || '-'], ['Local de execução', m.local || '-'],
      ['Regime tributário do prestador', regime], ['Validade da proposta', validade],
      ['Simulação feita por', [lead && lead.name, lead && lead.company].filter(Boolean).join(' · ') || '-'],
    ], { columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' } }, showHead: false });

    // Destaque
    doc.setFillColor(...INK); doc.roundedRect(12, y - 2, W - 24, 22, 2, 2, 'F');
    const col = (W - 24) / 4;
    [['Valor mensal', fmt(r.fatura)], ['Valor anual (12 meses)', fmt(r.fatura * 12)], ['Funcionários', String(r.headcount)], ['Preço por funcionário', fmt(r.porFuncionario)]].forEach((k, i) => {
      const x = 16 + i * col;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(25, 212, 107); doc.text(k[0].toUpperCase(), x, y + 5);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(255, 255, 255); doc.text(k[1], x, y + 13);
    });
    doc.setTextColor(...INK);
    y += 28;

    // Postos
    y = titulo(doc, y, 'Quadro de cargos e remuneração');
    y = tabela(doc, y, ['Cargo / posto', 'Qtd', 'Salário-base', 'Ad. noturno', 'Periculosidade', 'Insalubridade', 'Total mensal'],
      r.cargos.map(c => [c.desc, String(c.qtd), fmt(c.salario), fmt(c.adn), fmt(c.peric), fmt(c.insal), fmt(c.total)]),
      { columnStyles: { 1: dir, 2: dir, 3: dir, 4: dir, 5: dir, 6: dir } });

    // Módulos
    const nomes = { 1: 'Módulo 1 · Composição da remuneração', 2: 'Módulo 2 · Benefícios mensais e diários', 3: 'Módulo 3 · Insumos diversos', 4: 'Módulo 4 · Encargos sociais e trabalhistas', 5: 'Módulo 5 · Custos indiretos, lucro e tributos' };
    const totMod = { 1: r.modulos.m1, 2: r.modulos.m2, 3: r.modulos.m3, 4: r.modulos.m4, 5: r.modulos.m5 };
    [1, 2, 3, 4, 5].forEach(k => {
      const linhas = r.linhas.filter(l => l.mod === k);
      if (!linhas.length) return;
      y = titulo(doc, y, nomes[k]);
      const body = linhas.map(l => [l.cod, l.desc, l.pct != null ? pct(l.pct) : '', fmt(l.valor)]);
      body.push([{ content: 'Total', colSpan: 3, styles: { fontStyle: 'bold' } }, { content: fmt(totMod[k]), styles: { fontStyle: 'bold', halign: 'right' } }]);
      y = tabela(doc, y, ['', 'Descrição', '%', 'Valor mensal'], body, { columnStyles: { 0: { cellWidth: 14 }, 2: Object.assign({ cellWidth: 22 }, dir), 3: Object.assign({ cellWidth: 32 }, dir) } });
    });

    // Quadro-resumo
    y = titulo(doc, y, 'Quadro-resumo do preço');
    const F = r.fatura || 1;
    const resumo = [
      ['A', 'Módulo 1 · Remuneração', fmt(r.modulos.m1), pct(r.modulos.m1 / F, 1)],
      ['B', 'Módulo 2 · Benefícios', fmt(r.modulos.m2), pct(r.modulos.m2 / F, 1)],
      ['C', 'Módulo 3 · Insumos', fmt(r.modulos.m3), pct(r.modulos.m3 / F, 1)],
      ['D', 'Módulo 4 · Encargos', fmt(r.modulos.m4), pct(r.modulos.m4 / F, 1)],
      [{ content: 'Subtotal (A + B + C + D)', colSpan: 2, styles: { fontStyle: 'bold' } }, { content: fmt(r.subtotal), styles: { fontStyle: 'bold', halign: 'right' } }, pct(r.subtotal / F, 1)],
      ['E', 'Custos indiretos', fmt(r.indiretos), pct(r.indiretos / F, 1)],
      ['F', 'Lucro', fmt(r.lucro), pct(r.lucro / F, 1)],
      ['G', 'Tributos sobre o faturamento', fmt(r.tributos), pct(r.tributos / F, 1)],
      [{ content: 'Valor mensal da fatura', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [230, 247, 238] } }, { content: fmt(r.fatura), styles: { fontStyle: 'bold', halign: 'right', fillColor: [230, 247, 238] } }, { content: '100%', styles: { fillColor: [230, 247, 238], halign: 'right' } }],
    ];
    r.retencoes.forEach(x => resumo.push(['', `(−) ${x.desc} ${pct(x.pct)}`, fmt(-x.valor), '']));
    if (r.retencoes.length) resumo.push([{ content: 'Fatura líquida (entrada de caixa)', colSpan: 2, styles: { fontStyle: 'bold' } }, { content: fmt(r.faturaLiquida), styles: { fontStyle: 'bold', halign: 'right' } }, '']);
    y = tabela(doc, y, ['', 'Item', 'Valor mensal', '% da fatura'], resumo, { columnStyles: { 0: { cellWidth: 10 }, 2: Object.assign({ cellWidth: 34 }, dir), 3: Object.assign({ cellWidth: 24 }, dir) } });

    // Premissas
    y = titulo(doc, y, 'Premissas');
    const b = inp.beneficios;
    const prem = [
      `Encargos sociais e trabalhistas de ${pct(r.pctEncargos)} sobre a remuneração (FGTS, provisões de 13º, férias, rescisão e reposição de ausências${r.encargos['4.1'].pct > 0.09 ? ', INSS patronal e RAT' : ''}).`,
      `Tributos de ${pct(r.pctTributos)} calculados sobre o valor da fatura (${regime}).`,
      `Vale-transporte: ${fmt(b.vtTarifa)} × ${b.vtViagensDia} conduções × ${b.vtDias} dias, com desconto de ${pct(b.vtDescontoPct, 0)} do salário. Alimentação: ${fmt(b.vaValorDia)} × ${b.vaDias} dias.`,
      `Custos indiretos de ${pct(inp.indiretos.custosIndiretosPct)} e lucro de ${pct(inp.indiretos.lucroPct)}.`,
      'Valores sujeitos a reajuste na data-base da convenção coletiva da categoria.',
    ];
    if (m.observacoes) prem.push(m.observacoes);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(...INK);
    prem.forEach(p => {
      const ls = doc.splitTextToSize(limpa('• ' + p), W - 28);
      if (y + ls.length * 4 > doc.internal.pageSize.getHeight() - 22) { doc.addPage(); y = 20; }
      doc.text(ls, 14, y); y += ls.length * 4 + 1.2;
    });

    rodapes(doc, `Simulação gerada em ${new Date().toLocaleString('pt-BR')}. Valores gerenciais: confira com a convenção coletiva e a contabilidade antes de assinar.`);
    return doc;
  }

  // ─────────────────────── RELATÓRIO DE ACOMPANHAMENTO ───────────────────────
  function relatorio(c, D, h) {
    const doc = novoDoc('landscape');
    const ult = D.meses[D.meses.length - 1];
    let y = cabecalho(doc, 'ACOMPANHAMENTO DO CONTRATO', `${c.nome} · ${mesLabel(D.meses[0])} a ${mesLabel(ult)}`);
    const orcU = h.orcadoDoMes(ult);
    const desv = D.acum.orc ? (D.acum.real - D.acum.orc) / D.acum.orc : 0;
    y = tabela(doc, y, ['Indicador', 'Valor'], [
      ['Fatura orçada vigente', fmt(orcU.fatura)],
      ['Custo acumulado orçado', fmt(D.acum.orc)],
      ['Custo acumulado realizado', `${fmt(D.acum.real)} (${desv > 0 ? '+' : ''}${pct(desv, 1)})`],
      ['Margem realizada acumulada', D.acum.fat ? pct(D.acum.res / D.acum.fat, 1) : '-'],
      ['Tolerância de desvio', pct(c.tolerancia, 1)],
    ], { showHead: false, columnStyles: { 0: { cellWidth: 70, fontStyle: 'bold' } }, tableWidth: 150 });

    y = titulo(doc, y, 'Orçado x realizado por competência');
    const st = { ok: 'Dentro', atencao: 'Na tolerância', estouro: 'Acima', pendente: 'Pendente' };
    y = tabela(doc, y, ['Competência', 'Faturamento', 'Custo orçado', 'Custo realizado', 'Desvio R$', 'Desvio %', 'Margem orçada', 'Margem real', 'Situação'],
      D.comps.map(x => { const k = x.cmp; return [mesLabel(x.mes), k.fatReal === null ? '-' : fmt(k.fatReal), fmt(k.custoOrc), k.custoReal === null ? '-' : fmt(k.custoReal),
        k.desvioCusto === null ? '-' : fmt(k.desvioCusto), k.desvioCustoPct === null ? '-' : pct(k.desvioCustoPct, 1), pct(k.margemOrcPct, 1), k.margemRealPct === null ? '-' : pct(k.margemRealPct, 1), st[k.status]]; }),
      { columnStyles: { 1: dir, 2: dir, 3: dir, 4: dir, 5: dir, 6: dir, 7: dir },
        didParseCell: d => { if (d.section === 'body' && d.column.index === 8) { const s = D.comps[d.row.index].cmp.status; d.cell.styles.textColor = s === 'estouro' ? [214, 59, 59] : s === 'atencao' ? [201, 138, 0] : s === 'ok' ? [15, 155, 79] : STEEL; d.cell.styles.fontStyle = 'bold'; } } });

    y = titulo(doc, y, 'Variação mês a mês dos custos realizados');
    const V = D.varia;
    const linhas = E.GRUPOS.map(g => [g.label, x => x.grupos[g.k], true]).concat([['Custo total', x => x.custoTotal, true], ['Custo por funcionário', x => x.custoPorFuncionario, true], ['Faturamento', x => x.faturamento, false]]);
    const cor = [];
    const body = linhas.map((l, ri) => [l[0]].concat(V.map((x, ci) => {
      const d = l[1](x);
      if (!d || d.valor === null) return '-';
      if (d.deltaPct === null) return fmt(d.valor);
      const subiu = l[2] ? d.deltaPct > c.tolerancia : -d.deltaPct > c.tolerancia;
      const caiu = l[2] ? d.deltaPct < -c.tolerancia : -d.deltaPct < -c.tolerancia;
      if (subiu) cor.push([ri, ci + 1, [214, 59, 59]]); else if (caiu) cor.push([ri, ci + 1, [15, 155, 79]]);
      return `${fmt(d.valor)}\n${d.deltaPct > 0 ? '+' : ''}${pct(d.deltaPct, 1)}`;
    })));
    y = tabela(doc, y, ['Item'].concat(V.map(x => mesLabel(x.mes))), body, {
      styles: Object.assign({}, tabelaBase.styles, { fontSize: 7.4 }),
      columnStyles: Object.fromEntries(V.map((_, i) => [i + 1, dir])),
      didParseCell: d => { if (d.section !== 'body') return; const k = cor.find(z => z[0] === d.row.index && z[1] === d.column.index); if (k) { d.cell.styles.textColor = k[2]; d.cell.styles.fontStyle = 'bold'; } },
    });

    const obs = D.meses.filter(m => c.meses[m].obs).map(m => [mesLabel(m), c.meses[m].obs]);
    if (obs.length) { y = titulo(doc, y, 'Observações'); y = tabela(doc, y, ['Competência', 'Observação'], obs, { columnStyles: { 0: { cellWidth: 30 } } }); }
    const vers = c.versoes.map(v => { const r = E.calcular(v.inp); return [mesLabel(v.vigencia), fmt(r.fatura), String(r.headcount), v.inp.regime === 'simples' ? 'Simples ' + v.inp.simples.anexo : 'Presumido']; });
    y = titulo(doc, y, 'Versões do orçamento');
    tabela(doc, y, ['Vigência', 'Fatura mensal', 'Funcionários', 'Regime'], vers, { tableWidth: 160, columnStyles: { 1: dir, 2: dir } });

    rodapes(doc, `Relatório gerado em ${new Date().toLocaleString('pt-BR')}. Desvio positivo = custo acima do orçado.`);
    return doc;
  }

  window.StarqiaPDF = { proposta, relatorio };
})();
