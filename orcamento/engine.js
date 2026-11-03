/*
 * STARQIA – Motor de Formação de Preço de Serviços Terceirizados
 * Replica a sistemática da planilha "MODELO ORÇAMENTO PORTARIA E RONDA"
 * (Módulos 1 a 5 + retenções), com suporte a Simples Nacional e Lucro Presumido.
 *
 * Funções puras: não dependem do DOM. Podem rodar no navegador ou em Node.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Tabelas do Simples Nacional (LC 123/2006, redação LC 155/2016)
  // [limite RBT12, alíquota nominal, parcela a deduzir]
  // ---------------------------------------------------------------------------
  const SIMPLES = {
    III: [[180000, 0.06, 0], [360000, 0.112, 9360], [720000, 0.135, 17640],
          [1800000, 0.16, 35640], [3600000, 0.21, 125640], [4800000, 0.33, 648000]],
    IV:  [[180000, 0.045, 0], [360000, 0.09, 8100], [720000, 0.102, 12420],
          [1800000, 0.14, 39780], [3600000, 0.22, 183780], [4800000, 0.33, 828000]],
    V:   [[180000, 0.155, 0], [360000, 0.18, 4500], [720000, 0.195, 9900],
          [1800000, 0.205, 17100], [3600000, 0.23, 62100], [4800000, 0.305, 540000]],
  };

  /** Alíquota efetiva do Simples: (RBT12 × Aliq − PD) / RBT12 */
  function aliquotaEfetivaSimples(anexo, rbt12) {
    const tab = SIMPLES[anexo];
    if (!tab || !(rbt12 > 0)) return 0;
    const faixa = tab.find(f => rbt12 <= f[0]) || tab[tab.length - 1];
    return Math.max(0, (rbt12 * faixa[1] - faixa[2]) / rbt12);
  }

  // ---------------------------------------------------------------------------
  // Presets de encargos (Módulo 4.1) por regime – todos editáveis na tela
  // ---------------------------------------------------------------------------
  const PRESETS_41 = {
    // Simples – Anexo III/V: CPP já está dentro do DAS
    simples_III: { inss: 0, sesi: 0, senai: 0, incra: 0, salEdu: 0, fgts: 0.08, rat: 0, sebrae: 0 },
    // Simples – Anexo IV (vigilância, limpeza, conservação): CPP 20% + RAT fora do DAS
    simples_IV:  { inss: 0.20, sesi: 0, senai: 0, incra: 0, salEdu: 0, fgts: 0.08, rat: 0.03, sebrae: 0 },
    simples_V:   { inss: 0, sesi: 0, senai: 0, incra: 0, salEdu: 0, fgts: 0.08, rat: 0, sebrae: 0 },
    // Lucro Presumido: INSS patronal + terceiros (Sistema S, INCRA, Sal. Educação) + RAT×FAP
    presumido:   { inss: 0.20, sesi: 0.015, senai: 0.01, incra: 0.002, salEdu: 0.025, fgts: 0.08, rat: 0.03, sebrae: 0.006 },
  };

  const PRESET_PRESUMIDO_TRIB = { pis: 0.0065, cofins: 0.03, irpj: 0.048, csll: 0.0288, iss: 0.05 };

  // ---------------------------------------------------------------------------
  // Modelo padrão (baseado na aba "VENDAS ORÇAMENTO PORTARIA + RONDA")
  // ---------------------------------------------------------------------------
  function modeloPadrao(tipo) {
    const base = {
      versao: 1,
      meta: {
        proposta: '', cliente: '', contato: '', email: '', telefone: '',
        servico: 'Portaria e Ronda', local: '', data: new Date().toISOString().slice(0, 10),
        validadeDias: 30, observacoes: '',
      },
      regime: 'simples',          // 'simples' | 'presumido'
      simples: { anexo: 'IV', modo: 'tabela', rbt12: 1200000, aliquotaManual: 0.0511 },
      presumido: Object.assign({}, PRESET_PRESUMIDO_TRIB),
      outrosTributosPct: 0,       // p.ex. CBS/IBS de transição, quando aplicável

      cargos: [
        { desc: 'Porteiro diurno 12x36', qtd: 2, salario: 1681.71, noturno: false, horasNot: 105, dsrNot: 3.5, periculosidadePct: 0, insalubridadePct: 0, gratificacao: 0 },
        { desc: 'Porteiro noturno 12x36', qtd: 2, salario: 1681.71, noturno: true, horasNot: 105, dsrNot: 3.5, periculosidadePct: 0, insalubridadePct: 0, gratificacao: 0 },
      ],
      salarioMinimo: 1518.00,     // base de cálculo de insalubridade
      horaExtraFT: 228.96,        // valor total mensal de horas extras / folguistas (FT)
      outrasRemuneracoes: 0,

      beneficios: {
        vtTarifa: 4.20, vtViagensDia: 2, vtDias: 16, vtDescontoPct: 0.06,
        vaValorDia: 20.61, vaDias: 16, vaDescontoPct: 0,
        itens: [
          { desc: 'Cesta básica', valor: 123.82, periodo: 'mensal' },
          { desc: 'Seguro de vida', valor: 0, periodo: 'mensal' },
          { desc: 'Benefício social familiar', valor: 13.67, periodo: 'mensal' },
          { desc: 'Assistência odontológica', valor: 23.50, periodo: 'mensal' },
          { desc: 'Plano de saúde', valor: 0, periodo: 'mensal' },
          { desc: 'PPR', valor: 290.50, periodo: 'anual' },
        ],
      },

      insumos: [
        { desc: 'Uniformes', qtd: 1, valor: 300, base: 'porFuncionario', periodo: 'anual' },
        { desc: 'Medicina ocupacional (exames)', qtd: 1, valor: 2, base: 'porFuncionario', periodo: 'mensal' },
        { desc: 'Laudos PGR/PCMSO', qtd: 1, valor: 470, base: 'fixo', periodo: 'anual' },
        { desc: 'RH / Departamento Pessoal', qtd: 1, valor: 10, base: 'porFuncionario', periodo: 'mensal' },
        { desc: 'Equipamentos (rádio/HT, bastão)', qtd: 1, valor: 100, base: 'fixo', periodo: 'anual' },
        { desc: 'Combustível / deslocamento supervisão', qtd: 1, valor: 100, base: 'fixo', periodo: 'mensal' },
      ],

      encargos: {
        g41: Object.assign({}, PRESETS_41.simples_IV),
        g42: { decimo: 0.0833 },
        g43: { maternidade: 0.01 },
        g44: { avisoIndenizado: 0.0833, multaFgtsAvisoInd: 0.04, avisoTrabalhado: 0.0002, multaFgtsAvisoTrab: 0.0001 },
        g45: { ferias: 0.1111, doenca: 0.01, paternidade: 0.0001, ausenciasLegais: 0.01, acidente: 0.01, outros: 0 },
      },

      indiretos: {
        custosIndiretosPct: 0.05,   // sobre o subtotal (Módulos 1 a 4)
        custoAdministrativoPct: 0,  // sobre o subtotal
        seguroPct: 0,               // seguro de veículos/responsabilidade, sobre o subtotal
        sindicatoPatronalAnual: 0,  // R$/ano rateado por 12
        outrosMensal: 0,            // R$/mês
        lucroPct: 0.10,             // sobre (subtotal + custos indiretos)
      },

      retencoes: { inssPct: 0.11, issPct: 0, irPct: 0, csrfPct: 0 },
    };

    if (tipo === 'limpeza') {
      base.meta.servico = 'Limpeza e Conservação';
      base.cargos = [
        { desc: 'Auxiliar de limpeza 44h', qtd: 2, salario: 1384.64, noturno: false, horasNot: 0, dsrNot: 0, periculosidadePct: 0, insalubridadePct: 0.20, gratificacao: 0 },
        { desc: 'Líder de limpeza 44h', qtd: 1, salario: 1588.30, noturno: false, horasNot: 0, dsrNot: 0, periculosidadePct: 0, insalubridadePct: 0.20, gratificacao: 0 },
      ];
      base.horaExtraFT = 0;
      base.beneficios.vtTarifa = 4.80; base.beneficios.vtDias = 22;
      base.beneficios.vaValorDia = 17.77; base.beneficios.vaDias = 22;
      base.insumos = [
        { desc: 'Uniformes', qtd: 1, valor: 85.90, base: 'porFuncionario', periodo: 'anual' },
        { desc: 'EPI', qtd: 1, valor: 15, base: 'porFuncionario', periodo: 'mensal' },
        { desc: 'Materiais de limpeza', qtd: 1, valor: 800, base: 'fixo', periodo: 'mensal' },
        { desc: 'Equipamentos (depreciação)', qtd: 1, valor: 1200, base: 'fixo', periodo: 'anual' },
        { desc: 'Medicina ocupacional (exames)', qtd: 1, valor: 2, base: 'porFuncionario', periodo: 'mensal' },
        { desc: 'Laudos PGR/PCMSO', qtd: 1, valor: 470, base: 'fixo', periodo: 'anual' },
      ];
    }
    return base;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const n = v => (typeof v === 'number' && isFinite(v)) ? v : (parseFloat(v) || 0);
  const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
  const soma = obj => Object.values(obj).reduce((a, b) => a + n(b), 0);

  /** Adicional noturno com DSR (fórmula da planilha, bloco "CÁLCULO ADN") */
  function adicionalNoturno(salario, horasNot, dsrNot) {
    const hora = n(salario) / 220;
    const adn = hora * 0.2 * n(horasNot);
    return adn + (adn / 26) * n(dsrNot);
  }

  // ---------------------------------------------------------------------------
  // Cálculo principal
  // ---------------------------------------------------------------------------
  function calcular(inp) {
    const L = []; // linhas detalhadas para tela/PDF: {mod, cod, desc, base, pct, valor}
    const push = (mod, cod, desc, valor, extra) => { L.push(Object.assign({ mod, cod, desc, valor: valor }, extra || {})); return valor; };

    // ---------- Módulo 1 – Remuneração ----------
    const headcount = inp.cargos.reduce((a, c) => a + n(c.qtd), 0);
    let m1 = 0;
    const cargosCalc = inp.cargos.map((c, i) => {
      const qtd = n(c.qtd), sal = n(c.salario);
      const adn = c.noturno ? adicionalNoturno(sal, c.horasNot, c.dsrNot) : 0;
      const peric = sal * n(c.periculosidadePct);
      const insal = n(inp.salarioMinimo) * n(c.insalubridadePct);
      const unit = sal + adn + peric + insal + n(c.gratificacao);
      const total = unit * qtd;
      m1 += total;
      push(1, String.fromCharCode(65 + i), `${c.desc} (${qtd} × ${fmt(unit)})`, total,
        { detalhe: { salario: sal, adn, peric, insal, gratificacao: n(c.gratificacao) } });
      return { desc: c.desc, qtd, salario: sal, adn, peric, insal, unit, total };
    });
    m1 += push(1, 'HE', 'Horas extras / folguistas (FT)', n(inp.horaExtraFT));
    m1 += push(1, 'OR', 'Outras remunerações', n(inp.outrasRemuneracoes));
    const salariosBase = cargosCalc.reduce((a, c) => a + c.salario * c.qtd, 0);

    // ---------- Módulo 2 – Benefícios ----------
    const b = inp.beneficios;
    const vtBruto = n(b.vtTarifa) * n(b.vtViagensDia) * n(b.vtDias) * headcount;
    // desconto legal de até 6% do salário-base, limitado ao custo do VT
    const vtDesc = Math.min(vtBruto, salariosBase * n(b.vtDescontoPct));
    const vaBruto = n(b.vaValorDia) * n(b.vaDias) * headcount;
    const vaDesc = vaBruto * n(b.vaDescontoPct);
    let m2 = 0;
    m2 += push(2, 'A', 'Vale-transporte', vtBruto);
    m2 += push(2, 'A.1', `(−) Desconto VT ${pct(b.vtDescontoPct)} do salário`, -vtDesc);
    m2 += push(2, 'B', 'Auxílio-alimentação', vaBruto);
    if (vaDesc) m2 += push(2, 'B.1', '(−) Desconto alimentação', -vaDesc);
    let letraB = 67; // C, D, E... sem pular letras quando um item é zero
    (b.itens || []).forEach(it => {
      const v = n(it.valor) * headcount / (it.periodo === 'anual' ? 12 : 1);
      if (n(it.valor) !== 0) m2 += push(2, String.fromCharCode(letraB++), it.desc + (it.periodo === 'anual' ? ' (anual ÷ 12)' : ''), v);
    });

    // ---------- Módulo 3 – Insumos ----------
    let m3 = 0;
    let letraI = 65;
    (inp.insumos || []).forEach(it => {
      const mult = it.base === 'porFuncionario' ? headcount : 1;
      const v = n(it.qtd) * n(it.valor) * mult / (it.periodo === 'anual' ? 12 : 1);
      if (v !== 0) m3 += push(3, String.fromCharCode(letraI++), it.desc + (it.periodo === 'anual' ? ' (anual ÷ 12)' : ''), v);
    });

    // ---------- Módulo 4 – Encargos (percentuais sobre o Módulo 1) ----------
    const e = inp.encargos;
    const p41 = soma(e.g41);
    const p42 = n(e.g42.decimo) * (1 + p41);
    const p43 = n(e.g43.maternidade) * (1 + p41);
    const g44 = e.g44;
    const p44 = n(g44.avisoIndenizado) + n(e.g41.fgts) * n(g44.avisoIndenizado) + n(g44.multaFgtsAvisoInd)
              + n(g44.avisoTrabalhado) * (1 + p41) + n(g44.multaFgtsAvisoTrab);
    const p45 = soma(e.g45) * (1 + p41);
    const enc = {
      '4.1': { desc: 'Encargos previdenciários, FGTS e outras contribuições', pct: p41 },
      '4.2': { desc: '13º salário (+ incidência do 4.1)', pct: p42 },
      '4.3': { desc: 'Afastamento maternidade (+ incidência do 4.1)', pct: p43 },
      '4.4': { desc: 'Provisão para rescisão', pct: p44 },
      '4.5': { desc: 'Reposição do profissional ausente (+ incidência do 4.1)', pct: p45 },
    };
    let m4 = 0;
    Object.keys(enc).forEach(k => { enc[k].valor = enc[k].pct * m1; m4 += push(4, k, enc[k].desc, enc[k].valor, { pct: enc[k].pct }); });
    const pctEncargos = p41 + p42 + p43 + p44 + p45;

    const subtotal = m1 + m2 + m3 + m4;

    // ---------- Módulo 5 – Custos indiretos, lucro e tributos ----------
    const ind = inp.indiretos;
    const ci = subtotal * n(ind.custosIndiretosPct);
    const adm = subtotal * n(ind.custoAdministrativoPct);
    const seg = subtotal * n(ind.seguroPct);
    const sind = n(ind.sindicatoPatronalAnual) / 12;
    const outrosInd = n(ind.outrosMensal);
    const indiretos = ci + adm + seg + sind + outrosInd;
    const lucro = (subtotal + ci) * n(ind.lucroPct);

    // Tributos "por dentro": incidem sobre o faturamento (Nota 2 da planilha)
    const trib = [];
    if (inp.regime === 'simples') {
      const s = inp.simples;
      const aliq = s.modo === 'manual' ? n(s.aliquotaManual) : aliquotaEfetivaSimples(s.anexo, n(s.rbt12));
      trib.push({ cod: 'DAS', desc: `Simples Nacional – Anexo ${s.anexo} (alíquota efetiva)`, pct: aliq });
    } else {
      const p = inp.presumido;
      trib.push({ cod: 'PIS', desc: 'PIS (cumulativo)', pct: n(p.pis) });
      trib.push({ cod: 'COFINS', desc: 'COFINS (cumulativo)', pct: n(p.cofins) });
      trib.push({ cod: 'IRPJ', desc: 'IRPJ (32% × 15%)', pct: n(p.irpj) });
      trib.push({ cod: 'CSLL', desc: 'CSLL (32% × 9%)', pct: n(p.csll) });
      trib.push({ cod: 'ISS', desc: 'ISS', pct: n(p.iss) });
    }
    if (n(inp.outrosTributosPct)) trib.push({ cod: 'OUT', desc: 'Outros tributos sobre faturamento', pct: n(inp.outrosTributosPct) });
    const pctTributos = trib.reduce((a, t) => a + t.pct, 0);

    const antesTributos = subtotal + indiretos + lucro;
    const fatura = pctTributos < 1 ? antesTributos / (1 - pctTributos) : 0;
    trib.forEach(t => { t.valor = fatura * t.pct; });
    const tributos = trib.reduce((a, t) => a + t.valor, 0);

    push(5, 'A', `Custos indiretos (${pct(ind.custosIndiretosPct)} do subtotal)`, ci);
    if (adm) push(5, 'A.1', `Custo administrativo (${pct(ind.custoAdministrativoPct)})`, adm);
    if (seg) push(5, 'A.2', `Seguros (${pct(ind.seguroPct)})`, seg);
    if (sind) push(5, 'A.3', 'Contribuição sindical patronal (anual ÷ 12)', sind);
    if (outrosInd) push(5, 'A.4', 'Outros custos indiretos', outrosInd);
    push(5, 'B', `Lucro (${pct(ind.lucroPct)})`, lucro);
    trib.forEach(t => push(5, t.cod, `${t.desc} – ${pct(t.pct)}`, t.valor, { pct: t.pct, tributo: true }));
    const m5 = indiretos + lucro + tributos;

    // ---------- Retenções na fonte (pagas pelo tomador) ----------
    const ret = inp.retencoes;
    const retList = [
      { desc: 'INSS retido (cessão de mão de obra)', pct: n(ret.inssPct) },
      { desc: 'ISS retido', pct: n(ret.issPct) },
      { desc: 'IRRF', pct: n(ret.irPct) },
      { desc: 'CSRF (PIS/COFINS/CSLL)', pct: n(ret.csrfPct) },
    ].filter(x => x.pct).map(x => Object.assign(x, { valor: fatura * x.pct }));
    const totalRetencoes = retList.reduce((a, x) => a + x.valor, 0);

    return {
      headcount,
      cargos: cargosCalc,
      linhas: L,
      modulos: { m1, m2, m3, m4, m5 },
      encargos: enc, pctEncargos,
      subtotal, indiretos, ci, lucro, tributos, tributosDet: trib, pctTributos,
      custoTotal: subtotal + indiretos,          // custo operacional (sem lucro e tributos)
      fatura,
      porFuncionario: headcount ? fatura / headcount : 0,
      retencoes: retList, totalRetencoes,
      faturaLiquida: fatura - totalRetencoes,
      margemPct: fatura ? lucro / fatura : 0,
      // Grupos usados no acompanhamento mensal (orçado x realizado)
      grupos: {
        remuneracao: m1, beneficios: m2, insumos: m3, encargos: m4,
        indiretos, tributos, lucro, faturamento: fatura,
      },
    };
  }

  // Grupos do acompanhamento: chave, rótulo, se é custo (true) ou receita/resultado
  const GRUPOS = [
    { k: 'remuneracao', label: 'Remuneração (folha)', custo: true, dica: 'Salários, adicionais, horas extras e FT da folha do mês' },
    { k: 'beneficios', label: 'Benefícios', custo: true, dica: 'VT, VA, cesta, seguro, plano etc., líquidos dos descontos' },
    { k: 'insumos', label: 'Insumos', custo: true, dica: 'Uniformes, EPI, materiais, exames, equipamentos' },
    { k: 'encargos', label: 'Encargos e provisões', custo: true, dica: 'INSS/FGTS pagos + provisões de 13º, férias e rescisão do mês' },
    { k: 'indiretos', label: 'Custos indiretos', custo: true, dica: 'Supervisão, administrativo, seguros, sindicato' },
    { k: 'tributos', label: 'Tributos sobre faturamento', custo: true, dica: 'DAS ou PIS/COFINS/IRPJ/CSLL/ISS do contrato' },
  ];

  /** Compara o orçado (resultado do cálculo) com os valores realizados do mês */
  function compararMes(orcado, real, tolerancia) {
    const tol = n(tolerancia);
    const linhas = GRUPOS.map(g => {
      const o = n(orcado.grupos[g.k]);
      const rv = real[g.k];
      const temReal = rv !== '' && rv !== null && rv !== undefined;
      const r = n(rv);
      const desvio = temReal ? r - o : null;
      const desvioPct = temReal && o ? desvio / o : null;
      return { k: g.k, label: g.label, orcado: o, real: temReal ? r : null, desvio, desvioPct, status: status(desvioPct, tol, temReal) };
    });
    const custoOrc = linhas.reduce((a, x) => a + x.orcado, 0);
    const preenchidos = linhas.filter(x => x.real !== null);
    const custoReal = preenchidos.length ? linhas.reduce((a, x) => a + (x.real !== null ? x.real : x.orcado), 0) : null;
    const fatOrc = orcado.fatura;
    const fatReal = real.faturamento !== '' && real.faturamento != null ? n(real.faturamento) : null;
    const resultadoOrc = fatOrc - custoOrc;
    const resultadoReal = (fatReal !== null && custoReal !== null) ? fatReal - custoReal : null;
    const desvioCusto = custoReal !== null ? custoReal - custoOrc : null;
    const desvioCustoPct = custoReal !== null && custoOrc ? desvioCusto / custoOrc : null;
    return {
      linhas, custoOrc, custoReal, fatOrc, fatReal, resultadoOrc, resultadoReal,
      margemOrcPct: fatOrc ? resultadoOrc / fatOrc : 0,
      margemRealPct: resultadoReal !== null && fatReal ? resultadoReal / fatReal : null,
      desvioCusto, desvioCustoPct,
      status: status(desvioCustoPct, tol, custoReal !== null),
      completo: preenchidos.length === GRUPOS.length,
    };
  }

  /**
   * Variação mês a mês dos custos REALIZADOS.
   * registros: [{ mes:'2026-01', real:{remuneracao,...,faturamento}, headcount }] (qualquer ordem)
   * Retorna, por mês, cada grupo com valor, valor do mês anterior lançado, Δ R$ e Δ %,
   * além do custo total, custo por funcionário e faturamento.
   */
  function variacaoMesAMes(registros) {
    const temValor = v => v !== '' && v !== null && v !== undefined && isFinite(parseFloat(v));
    const ord = registros.slice().sort((a, b) => a.mes.localeCompare(b.mes));
    let ant = null;
    return ord.map(reg => {
      const real = reg.real || {};
      const grupos = {};
      let total = 0, algum = false;
      GRUPOS.forEach(g => {
        const v = temValor(real[g.k]) ? n(real[g.k]) : null;
        if (v !== null) { total += v; algum = true; }
        const a = ant ? ant.grupos[g.k].valor : null;
        grupos[g.k] = delta(v, a);
      });
      const custoTotal = algum ? total : null;
      const hc = n(reg.headcount) || null;
      const fat = temValor(real.faturamento) ? n(real.faturamento) : null;
      const linha = {
        mes: reg.mes, grupos,
        custoTotal: delta(custoTotal, ant ? ant.custoTotal.valor : null),
        custoPorFuncionario: delta(custoTotal !== null && hc ? custoTotal / hc : null, ant ? ant.custoPorFuncionario.valor : null),
        faturamento: delta(fat, ant ? ant.faturamento.valor : null),
        headcount: hc,
      };
      ant = linha;
      return linha;
    });
    function delta(v, a) {
      const d = v !== null && a !== null ? v - a : null;
      return { valor: v, anterior: a, delta: d, deltaPct: d !== null && a ? d / a : null };
    }
  }

  function status(desvioPct, tol, tem) {
    if (!tem || desvioPct === null) return 'pendente';
    if (desvioPct <= 0) return 'ok';
    if (desvioPct <= tol) return 'atencao';
    return 'estouro';
  }

  // Formatação
  function fmt(v) { return (n(v)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function pct(v, d) { return (n(v) * 100).toLocaleString('pt-BR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }) + '%'; }

  const API = { calcular, compararMes, variacaoMesAMes, modeloPadrao, aliquotaEfetivaSimples, adicionalNoturno,
    PRESETS_41, PRESET_PRESUMIDO_TRIB, SIMPLES, GRUPOS, fmt, pct, r2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.StarqiaEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
